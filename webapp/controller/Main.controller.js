sap.ui.define([
    "sap/ui/core/mvc/Controller",
	"sap/ui/export/Spreadsheet",
	"sap/ui/core/util/File",
], (Controller, Spreadsheet, FileUtil) => {
    "use strict";

    return Controller.extend("lomanegra.cargas.controller.Main", {
        onInit() {
			this.setFields();
        },

		setFields: function () {
			let oModel = this.getOwnerComponent().getModel("AppJsonModel");
			oModel.setProperty("/visibleTable", false);
		},

        onFileChange: function(oEvent) {
				const oModel = this.getModel("AppJsonModel");
				const file = oEvent.getParameter("files")[0];
				if (file && file.name.endsWith(".xlsx")) {
					const reader = new FileReader();
					reader.onload = async(e) => {
						const data = e.target.result;
						const workbook = XLSX.read(data, {
							type: "binary"
						});
						const sheetName = workbook.SheetNames[0];
						const sheet = workbook.Sheets[sheetName];
						const json = XLSX.utils.sheet_to_json(sheet);

						const mappedData = json.map((item) => ({
							Item: item["Item"],
							PurchaseRequisitionType: item["Purchase Requisition Type"],
							Material: item["Material"],
							Quantity: item["Quantity"],
							Unit: item["Unit"],
							Plant: item["Plant"],
							StorageLocation: item["Storage Location"],
							PurchasingGroup: item["Purchasing Group"],
							DeliveryDate: item["Delivery Date"],
						}));

						oModel.setProperty("/DataTemplate", mappedData);
					};
					reader.readAsBinaryString(file);
				}
			},

			onDownloadTemplate: async function() {
				var that = this;
				try {
				const aData = await this.readService();
				debugger;
			    that._downloadTemplate();
				} catch (err) {
					debugger;
					if (err.responseText !== undefined) {
						let error = JSON.parse(err.responseText).error.message.value;
						this.onShowError(error);
					}
				}
			},

			_downloadTemplate: function () {
				const sheetData = [{
					"Item": "",
					"Purchase Requisition Type": "",
					"Material": "",
					"Quantity": "",
					"Unit": "",
					"Plant": "",
					"Storage Location": "",
					"Purchasing Group": "",
					"Delivery Date": ""
				}];

				const ws = XLSX.utils.json_to_sheet(sheetData);
				const wb = XLSX.utils.book_new();
				XLSX.utils.book_append_sheet(wb, ws, "Template");
				const wbout = XLSX.write(wb, {
					bookType: "xlsx",
					type: "array"
				});

				FileUtil.save(new Blob([wbout]), "Plantilla_CargaMasiva", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
			},
			
			readService: function () {
				return new Promise((res, rej) => {
					this.getOwnerComponent().getModel("Cargas").read("/MuestreoSet", {
						success: res,
						error: rej
					});
				});
			},

			onPost: function() {
				// Por implementar: llamada al servicio de contabilización
			},

			onShowLog: function() {
				// Por implementar: lógica para mostrar logs
			},
    });
});