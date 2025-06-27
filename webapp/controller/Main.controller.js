sap.ui.define([
    "sap/ui/core/mvc/Controller",
	"sap/ui/export/Spreadsheet",
	"sap/ui/core/util/File",
	"sap/m/MessageBox",
	"sap/m/MessageToast"
], (Controller, Spreadsheet, FileUtil, MessageBox, MessageToast) => {
    "use strict";

    return Controller.extend("lomanegra.cargas.controller.Main", {
        onInit() {
			this.setFields();
        },

		setFields: function () {
			let oModel = this.getOwnerComponent().getModel("AppJsonModel");
			oModel.setProperty("/visibleTable", false);
		},

        onFileChange: function (oEvent) {
			const oModel = this.getOwnerComponent().getModel("AppJsonModel");
			const file = oEvent.getParameter("files")[0];

			if (file && file.name.endsWith(".xlsx")) {
				const reader = new FileReader();
				reader.onload = async (e) => {
					const data = e.target.result;
					const workbook = XLSX.read(data, { type: "binary" });
					const sheetName = workbook.SheetNames[0];
					const sheet = workbook.Sheets[sheetName];
					const jsonRaw = XLSX.utils.sheet_to_json(sheet);

					const json = jsonRaw.map(item => {
						// Copiar todo excepto status y message
						const { status, message, ...rest } = item;

						// Convertir valor a string
						return {
							...rest,
							valor: item.valor !== undefined && item.valor !== null
								? String(item.valor)
								: ""
						};
					});

					oModel.setProperty("/datosExcel", json);
					oModel.setProperty("/visibleTable", true);
				};
				reader.readAsBinaryString(file);
			}
		},

			onContabilizar: async function () {
				const oModel = this.getOwnerComponent().getModel("AppJsonModel");
				const oODataModel = this.getOwnerComponent().getModel("Cargas");

				// 1. Filtrar registros que tengan valor o fecha_real_medicion
				let aDatos = oModel.getProperty("/datosExcel") || [];
				const aDatosFiltrados = aDatos.filter(item =>
					item.valor?.toString().trim() !== "" ||
					item.fecha_real_medicion?.toString().trim() !== ""
				);

				// 2. Validación: No hay registros modificados
				if (!aDatosFiltrados.length) {
					MessageToast.show("No hay cambios para enviar al backend.");
					return;
				}

				oModel.setProperty("/busy", true);
				oModel.setProperty("/ErrorsTerminar", []);

				// 3. Función para manejar errores agrupados por registro
				const handleODataError = function (oError, item) {
					if (oError.responseText) {
						try {
							const oJsonErrors = JSON.parse(oError.responseText);
							const aRawErrors = oJsonErrors?.error?.innererror?.errordetails;

							const titulo = `key: ${item.key}  |  id_escenario: ${item.id_escenario}`;

							const mensajesConcatenados = Array.isArray(aRawErrors) && aRawErrors.length > 0
								? aRawErrors.map(e => "- " + (e.message || "Error desconocido")).join("\n")
								: oJsonErrors?.error?.message?.value || "Error desconocido";

							const nuevoError = {
								title: titulo,
								message: mensajesConcatenados,
								type: "Error"
							};

							const aErrorsModel = oModel.getProperty("/ErrorsTerminar") || [];

							// Ver si ya hay errores para esta key
							const existente = aErrorsModel.find(e => e.title === titulo);
							if (existente) {
								existente.message += `\n${mensajesConcatenados}`;
							} else {
								aErrorsModel.push(nuevoError);
							}

							oModel.setProperty("/ErrorsTerminar", aErrorsModel);
						} catch (e) {
							const fallbackError = {
								title: `key: ${item.key}  |  id_escenario: ${item.id_escenario}`,
								message: "Error desconocido al procesar la respuesta del servidor",
								type: "Error"
							};
							const currentErrors = oModel.getProperty("/ErrorsTerminar") || [];
							oModel.setProperty("/ErrorsTerminar", [...currentErrors, fallbackError]);
						}
					}
				}.bind(this); // ← importante para acceder a this

				// 4. Procesar cada registro con PUT
				for (let i = 0; i < aDatosFiltrados.length; i++) {
					const item = aDatosFiltrados[i];
					const sPath = `/MuestreoSet(key='${item.key}')`;

					await new Promise((resolve) => {
						oODataModel.update(sPath, item, {
							success: () => {
								console.log(`Actualizado OK: ${item.key}`);
								resolve();
							},
							error: (oError) => {
								handleODataError(oError, item);
								resolve();
							}
						});
					});
				}

				oModel.setProperty("/busy", false);

				// 5. Mostrar resumen y actualizar contador visual
				const errores = oModel.getProperty("/ErrorsTerminar") || [];
				const oErrorBtn = this.getView().byId("messagePopoverBtn");

				if (errores.length) {
					MessageBox.error("Se produjeron errores durante la carga. Consultá el detalle.");

					// 👉 Mostrar cantidad en el botón (ej: “Errores (2)”)
					if (oErrorBtn) {
						oErrorBtn.setText(`Errores (${errores.length})`);
					}
				} else {
					MessageToast.show(`Se actualizaron ${aDatosFiltrados.length} registros correctamente.`);

					// 👉 Limpiar el texto si no hay errores
					if (oErrorBtn) {
						oErrorBtn.setText("Errores");
					}
				}
				this.byId("fileUploader").setValue("");
			},
					
			onShowErrorsTerminar: function (oEvent) {
				if (!this.oMP) {
					this.createMessagePopover();
				}
				this.oMP.toggle(oEvent.getSource());
        	},

			createMessagePopover: function () {
				const that = this;

				this.oMP = new sap.m.MessagePopover({
					activeTitlePress: function (oEvent) {
						const oItem = oEvent.getParameter("item"),
							oPage = that.getView().byId("messageHandlingPage"),
							oMessage = oItem.getBindingContext("message").getObject(),
							oControl = sap.ui.core.Element.registry.get(oMessage.getControlId());

						if (oControl) {
							oPage.scrollToElement(oControl.getDomRef(), 200, [0, -100]);
							setTimeout(function () {
								const bIsBehindOtherElement = isBehindOtherElement(oControl.getDomRef());
								if (bIsBehindOtherElement) {
									this.close();
								}
								if (oControl.isFocusable()) {
									oControl.focus();
								}
							}.bind(this), 300);
						}
					},

					items: {
						path: "AppJsonModel>/ErrorsTerminar",
						template: new sap.m.MessageItem({
							// 👉 Título: key + id_escenario
							title: "{AppJsonModel>title}",

							// 👉 Mensaje de error
							description: "{AppJsonModel>message}",

							// 👉 Tipo de mensaje (Error, Warning, Info, Success)
							type: "{AppJsonModel>type}"
						})
					},

					groupItems: true // Agrupa por título
				});

				this.getView().byId("messagePopoverBtn").addDependent(this.oMP);
			},

			onDownloadTemplate: async function() {
				var that = this;
				let oModel = this.getOwnerComponent().getModel("AppJsonModel");
				try {
					oModel.setProperty("/busy", true);
					const aData = await this.readService();
					oModel.setProperty("/registros", aData.results);
					oModel.setProperty("/busy", false);
					that._downloadTemplate();
					} catch (err) {
						oModel.setProperty("/busy", false);
						if (err.responseText !== undefined) {
							let error = JSON.parse(err.responseText).error.message.value;
							MessageToast.show(error);
						}else{
							MessageToast.show("Error de comunicación");
						}
					}
			},

			_downloadTemplate: function () {
				const oModel = this.getOwnerComponent().getModel("AppJsonModel");
				const aRegistros = oModel.getProperty("/registros") || [];

				if (!aRegistros.length) {
					MessageToast.show("No hay datos para exportar.");
					return;
				}
				const keys = Object.keys(aRegistros[0]).filter(
								key => key !== "__metadata" && key !== "status" && key !== "message"
							);

				const sheetData = aRegistros.map(item => {
					const obj = {};
					keys.forEach(key => {
						obj[key] = item[key] ?? "";
					});
					return obj;
				});

				const ws = XLSX.utils.json_to_sheet(sheetData);
				const wb = XLSX.utils.book_new();
				XLSX.utils.book_append_sheet(wb, ws, "Datos");

				const wbout = XLSX.write(wb, {
					bookType: "xlsx",
					type: "array"
				});

				FileUtil.save(
					new Blob([wbout]),
					"Exportacion_CargaMasiva",
					"xlsx",
					"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
				);
			},
			
			readService: function () {
				return new Promise((res, rej) => {
					this.getOwnerComponent().getModel("Cargas").read("/MuestreoSet", {
						success: res,
						error: rej
					});
				});
			},
    });
});