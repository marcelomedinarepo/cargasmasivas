sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/export/Spreadsheet",
	"sap/ui/core/util/File",
	"sap/m/MessageBox",
	"sap/m/MessageToast"
], (Controller, Spreadsheet, FileUtil, MessageBox, MessageToast) => {
	"use strict";

	return Controller.extend("ehs.ehs142.cargamuestreos.app.controller.Main", {
		onInit() {
			this._setFields();
		},

		_setFields: function () {
			let oModel = this.getOwnerComponent().getModel("AppJsonModel");
			oModel.setProperty("/visibleTable", false);
			oModel.setProperty("/visibleLog", false);
			oModel.setProperty("/archivoCargado", false);
		},

		onFileChange: function (oEvent) {
			const oModel = this.getOwnerComponent().getModel("AppJsonModel");
			const file = oEvent.getParameter("files")[0];

			oModel.setProperty("/ErrorsTerminar", []);
			oModel.setProperty("/visibleLog", false);

			if (file && file.name.endsWith(".xlsx")) {
				oModel.setProperty("/archivoCargado", true);
				const reader = new FileReader();
				reader.onload = async (e) => {
					const data = e.target.result;
					const workbook = XLSX.read(data, { type: "binary" });
					const sheetName = workbook.SheetNames[0];
					const sheet = workbook.Sheets[sheetName];
					const jsonRaw = XLSX.utils.sheet_to_json(sheet);

					const json = jsonRaw.map(item => {
						const { status, message, ...rest } = item;
						return {
							...rest,
							valor: item.valor !== undefined && item.valor !== null ? String(item.valor) : ""
						};
					});

					oModel.setProperty("/datosExcel", json);
					oModel.setProperty("/visibleTable", true);
				};
				reader.readAsBinaryString(file);
			} else {
				oModel.setProperty("/archivoCargado", false); // archivo inválido
				oModel.setProperty("/visibleTable", false);
			}
		},

		onImport: async function () {
			const oModel = this.getOwnerComponent().getModel("AppJsonModel");
			if (this.oMP && this.oMP.isOpen()) {
				this.oMP.close();
				this.oMP.destroy();
				this.oMP = null;
			}

			if (!this.validarArchivoCargado()) return;

			const confirmado = await this.confirmarProcesamiento();
			if (!confirmado) return;

			if (!this.validarDatosCompletos()) return;

			const payload = this.construirPayload();

			oModel.setProperty("/busy", true);
			oModel.setProperty("/ErrorsTerminar", []);

			await this.enviarDatos(payload);

			oModel.setProperty("/busy", false);
		},

		validarArchivoCargado: function () {
			const file = this.byId("fileUploader").getValue();
			if (!file) {
				sap.m.MessageToast.show("Por favor, cargue una plantilla");
				return false;
			}
			return true;
		},

		validarDatosCompletos: function () {
			const oModel = this.getOwnerComponent().getModel("AppJsonModel");
			const aDatos = oModel.getProperty("/datosExcel") || [];

			const hayIncompletos = aDatos.some(item =>
				!item.valor?.toString().trim() || !item.fecha_real_medicion?.toString().trim()
			);

			if (hayIncompletos) {
				sap.m.MessageToast.show("Por favor, complete todos los registros.");
				return false;
			}
			return true;
		},

		construirPayload: function () {
			const oModel = this.getOwnerComponent().getModel("AppJsonModel");
			return {
				Dummy: "",
				MuestreoSet: oModel.getProperty("/datosExcel") || []
			};
		},

		enviarDatos: function (payload) {
			const oModel = this.getOwnerComponent().getModel("AppJsonModel");
			const oODataModel = this.getOwnerComponent().getModel("Cargas");

			return new Promise((resolve) => {
				oODataModel.create("/HeaderSet", payload, {
					success: (oData) => {
						// Limpiar popover anterior si existe
						this.oMP?.destroy();

						const mensajes = [];
						const aResultados = oData.MuestreoSet?.results || [];

						aResultados.forEach(item => {
							let tipoMensaje = "None";
							if (item.status === "S") tipoMensaje = "Success";
							else if (item.status === "E") tipoMensaje = "Error";
							else if (item.status === "W") tipoMensaje = "Warning";

							mensajes.push({
								title: `id_escenario: ${item.id_escenario} | id_muestreo: ${item.id_muestreo}`,
								message: item.message || "Sin mensaje",
								type: tipoMensaje
							});
						});

						oModel.setProperty("/ErrorsTerminar", mensajes);
						oModel.setProperty("/visibleLog", mensajes.length > 0);

						sap.m.MessageToast.show(`Se procesaron ${aResultados.length} registros.`);

						if (mensajes.length > 0) {
							setTimeout(() => {
								this.onShowErrorsTerminar({ getSource: () => this.byId("messagePopoverBtn") });
							}, 300);
						}

						resolve();
					},
					error: (oError) => {
						this.oMP?.destroy();

						const mensajesConcatenados = this.obtenerMensajeError(oError);

						oModel.setProperty("/ErrorsTerminar", [{
							title: "Error al grabar datos",
							message: mensajesConcatenados,
							type: "Error"
						}]);
						oModel.setProperty("/visibleLog", true);

						sap.m.MessageBox.error("Se produjeron errores durante la carga. Consultá el detalle.");
						resolve();
					}
				});
			});
		},

		obtenerMensajeError: function (oError) {
			try {
				const oJsonErrors = JSON.parse(oError.responseText);
				const aRawErrors = oJsonErrors?.error?.innererror?.errordetails;

				if (Array.isArray(aRawErrors) && aRawErrors.length > 0) {
					return aRawErrors.map(e => "- " + (e.message || "Error desconocido")).join("\n");
				}
				return oJsonErrors?.error?.message?.value || "Error desconocido";
			} catch (e) {
				return "Error desconocido al procesar la respuesta del servidor";
			}
		},

		onShowErrorsTerminar: function (oEvent) {
			const oSource = oEvent.getSource();

			// Si ya existe el MessagePopover, hacemos toggle sobre el botón actual
			if (this.oMP) {
				// Verificamos si aún está asociado al botón correcto
				if (this.oMP.isOpen()) {
					this.oMP.close();
				} else {
					this.oMP.toggle(oSource);
				}
				return;
			}

			// Si no existe, lo creamos y lo abrimos
			this.oMP = this.createMessagePopover(oSource);
			this.oMP.openBy(oSource);
		},


		createMessagePopover: function (oSource) {
			const oModel = this.getOwnerComponent().getModel("AppJsonModel");
			const aMensajes = oModel.getProperty("/ErrorsTerminar") || [];
			const cantidad = aMensajes.length;

			const oMP = new sap.m.MessagePopover();

			// Título resumen
			oMP.addItem(new sap.m.MessagePopoverItem({
				title: `${cantidad} registros procesados`,
				description: "",
				type: "None",
				activeTitle: false
			}));

			aMensajes.forEach(m => {
				oMP.addItem(new sap.m.MessagePopoverItem({
					type: m.type,
					title: m.title,
					description: m.message
				}));
			});

			oSource.addDependent(oMP);

			// Registrar el evento close para poder liberar la referencia si querés
			oMP.attachAfterClose(() => {
				this.oMP.destroy();
				this.oMP = null;
			});

			return oMP;
		},

		getHighestSeverityIcon: function (aMessages) {
			if (!Array.isArray(aMessages) || aMessages.length === 0) return "sap-icon://message-information";

			let icon = "sap-icon://message-information";
			aMessages.forEach(m => {
				if (m.type === "Error") icon = "sap-icon://error";
				else if (m.type === "Warning" && icon !== "sap-icon://error") icon = "sap-icon://alert";
				else if (m.type === "Success" && icon !== "sap-icon://error" && icon !== "sap-icon://alert") icon = "sap-icon://message-success";
			});
			return icon;
		},

		onDownloadTemplate: async function () {
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
				} else {
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

			const columnsToHide = ["key", "key_splng", "key_amns"];
			ws["!cols"] = ws["!cols"] || [];

			columnsToHide.forEach((colName) => {
				const index = keys.indexOf(colName);
				if (index > -1) {
					ws["!cols"][index] = { hidden: true };
				}
			});

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

		getHighestSeverityType: function (aMessages) {
			if (!Array.isArray(aMessages) || aMessages.length === 0) return "Neutral";

			let type = "Neutral";
			aMessages.forEach(m => {
				if (m.type === "Error") type = "Reject";
				else if (m.type === "Warning" && type !== "Reject") type = "Attention";
				else if (m.type === "Success" && type !== "Reject" && type !== "Attention") type = "Success";
			});
			return type;
		},

		getHighestSeverityText: function (aMessages) {
			if (!Array.isArray(aMessages)) return "";

			const countError = aMessages.filter(m => m.type === "Error").length;
			const countWarning = aMessages.filter(m => m.type === "Warning").length;
			const countSuccess = aMessages.filter(m => m.type === "Success").length;

			return [
				countError ? `${countError} errores` : null,
				countWarning ? `${countWarning} warnings` : null,
				countSuccess ? `${countSuccess} éxitos` : null
			].filter(Boolean).join(" - ");
		},

		confirmarProcesamiento: function () {
			return new Promise((resolve) => {
				sap.m.MessageBox.confirm("¿Desea enviar los datos a procesar?", {
					title: "Confirmación",
					actions: ["Confirmar", "Cancelar"],
					onClose: (sAction) => {
						resolve(sAction === "Confirmar");
					}
				});
			});
		}
	});
});
