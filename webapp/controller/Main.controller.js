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
				const aDatos = oModel.getProperty("/datosExcel") || [];
				oODataModel.setUseBatch(true);
				if (!aDatos.length) {
					MessageToast.show("No hay datos cargados desde el Excel.");
					return;
				}

				oModel.setProperty("/busy", true);

				let errores = [];

				for (let i = 0; i < aDatos.length; i++) {
					const item = aDatos[i];
					const sPath = `/MuestreoSet(key='${item.key}')`;

					// Método PUT
					await new Promise((resolve) => {
						oODataModel.update(sPath, item, {
							method: "PUT",
							success: () => {
								console.log(`Actualizado OK: ${item.key}`);
								resolve();
							},
							error: (oError) => {
								console.error(`Error al actualizar ${item.key}`, oError);
								errores.push(`Error en fila ${i + 1} (${item.key}): ${oError.message}`);
								resolve();
							}
						});
					});
				}

				oModel.setProperty("/busy", false);

				if (errores.length) {
					MessageBox.error("Errores durante la carga:\n\n" + errores.join("\n"));
				} else {
					MessageToast.show("Todos los registros se actualizaron correctamente.");
				}
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
				const keys = Object.keys(aRegistros[0]).filter(key => key !== "__metadata");

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

			onShowLog: function() {
				// Por implementar: lógica para mostrar logs
			},
    });
});