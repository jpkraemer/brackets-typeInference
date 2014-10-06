/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

/** 
 * Triggers: 
 * didReceiveTypeInformation - Triggered whenever new method arguments were collected. 
 */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var TheseusAgentWrapper = require("./TheseusAgentWrapper");

	function init () {
		TheseusAgentWrapper.registerForTheseusUpdates(function (result) {
			var nodeIdComponents = result.nodeId.split("-"); 
			return (nodeIdComponents[nodeIdComponents.length - 3] === "function");
		}, _newLogsHandler); 
	}

	function _newLogsHandler (results) {
		results = _.sortBy(results, "invocationId");
		var resultsToPassOn = [];

		for (var i = 0; i < results.length; i++) {
			var result = results[i]; 

			var resultToPassOn = { 
				functionIdentifier: result.nodeId,
				theseusInvocationId: result.invocationId
			};

			var argumentNames = _.pluck(result.arguments, "name");
			resultToPassOn.argumentTypes = _.chain(result.arguments).pluck("value").pluck("typeSpec").value();
			for (var j = 0; j < resultToPassOn.argumentTypes.length; j++) {
				resultToPassOn.argumentTypes[j].name = argumentNames[j];
			}

			resultToPassOn.lastArguments = result.arguments; 
			if (result.returnValue !== undefined) {
				resultToPassOn.returnType = result.returnValue.typeSpec; 
			}

			resultsToPassOn.push(resultToPassOn); 
		}
			
		$(exports).trigger("didReceiveTypeInformation", [ exports, resultsToPassOn, true ]); 
	}

    exports.init = init; 
});