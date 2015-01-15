/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

/** 
 * Triggers: 
 * didReceiveTypeInformation - Triggered whenever new method arguments were collected. 
 */

define(function (require, exports, module) {
	"use strict"; 

	var _ 						= require("./lib/lodash");
	var TheseusAgentWrapper 	= require("./TheseusAgentWrapper");
	var TypeInformation 		= require("./FunctionTypeInformation").TypeInformation;
	var TypeSpec 				= require("./FunctionTypeInformation").TypeSpec;

	function init () {
		TheseusAgentWrapper.registerForTheseusUpdates(function (result) {
			var nodeIdComponents = result.nodeId.split("-"); 
			return /(.*)\-function\-[^\/]*$/.test(result.nodeId);
		}, _newLogsHandler); 
	}

	function _newLogsHandler (results) {
		results = _.sortBy(results, "invocationId");
		var resultsToPassOn = [];

		var thesusTypeToTypeSpec  = function (theseusType) {
			var result = new TypeSpec();
			result.type = theseusType.type; 
			result.count = theseusType.count;
			switch(result.type) {
				case "array": 
					result.spec = _.map(theseusType.spec, function (elem) {
						return thesusTypeToTypeSpec(elem);
					});
					break;
				case "object":
					result.spec = _.mapValues(theseusType.spec, function (elem) {
						return thesusTypeToTypeSpec(elem);
					});
					if (theseusType.name !== "Object") {
						result.name = theseusType.name;
					}
			}

			return result;
		};

		var mappingFunction = function(element, index) {
			var result = new TypeInformation();
			result.name = argumentNames[index];
			result.type = thesusTypeToTypeSpec(element);
			return result;
		};

		for (var i = 0; i < results.length; i++) {
			var result = results[i]; 

			var resultToPassOn = { 
				functionIdentifier: result.nodeId,
				theseusInvocationId: result.invocationId
			};

			var argumentNames = _.pluck(result.arguments, "name");
			resultToPassOn.argumentTypes = _.chain(result.arguments).pluck("value").pluck("typeSpec").map(mappingFunction).value();

			resultToPassOn.lastArguments = result.arguments; 
			if (result.returnValue !== undefined) {
				resultToPassOn.returnType = new TypeInformation();
				resultToPassOn.returnType.type = thesusTypeToTypeSpec(result.returnValue.typeSpec); 
			}

			resultsToPassOn.push(resultToPassOn); 
		}
			
		$(exports).trigger("didReceiveTypeInformation", [ exports, resultsToPassOn, true ]); 
	}

    exports.init = init; 
});