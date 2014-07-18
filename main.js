/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var AppInit					= brackets.getModule("utils/AppInit");
	var TheseusTypeProvider 	= require("./src/TheseusTypeProvider");
	var TypeInformationStore 	= require("./src/TypeInformationStore"); 
	var TIUtils 				= require("./src/TIUtils");

	function _init () {
		TIUtils.log("loading... "); 

		TypeInformationStore.init();

		TheseusTypeProvider.init();

	}

	AppInit.appReady(_init);

	exports.version = JSON.parse(require("text!package.json")).version;
});