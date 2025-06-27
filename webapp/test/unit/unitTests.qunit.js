/* global QUnit */
// https://api.qunitjs.com/config/autostart/
QUnit.config.autostart = false;

sap.ui.require([
	"ehs/ehs142/cargamuestreos/app/test/unit/AllTests"
], function (Controller) {
	"use strict";
	QUnit.start();
});