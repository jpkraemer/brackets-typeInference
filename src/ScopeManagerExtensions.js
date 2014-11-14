/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 								= require("./lib/lodash");
	var ExtensionLoader 				= brackets.getModule("utils/ExtensionLoader");
	var TypeInformationHTMLRenderer 	= require("./TypeInformationHTMLRenderer");
	
	function init () {
		ExtensionLoader.getRequireContextForExtension("JavaScriptCodeHints")([ "ScopeManager" ], function (ScopeManager) {
			var oldParameterHint = ScopeManager.requestParameterHint; 
			ScopeManager.requestParameterHint = function (session, functionOffset) {
				var result = $.Deferred();
				var sharedSession = session;

				var document = session.editor.document; 
				//we need to find the function name for the function call 
				var sourceCode = document.getRange({ line: 0, ch: 0 }, functionOffset); 
				var functionName = _.findLast(sourceCode.split(/\s|^/m), function (partString) {
					return ! /^\s*$/.test(partString);
				}); 

				var typeInformation = document.typeInformationCollection.typeInformationForFunctionName(functionName);
				if (typeInformation) {
					var resultArray = _.map(typeInformation.argumentTypes, function (type) {
						var typeString = TypeInformationHTMLRenderer.typeSpecToHTML(type); 
						typeString = typeString.replace(/<.*?>/g, "");

						return {
							name: type.name,
							type: typeString,
							typeInformation: type
						};
					}); 

					//this marker will allow us to customize rendering 
					resultArray.providedByTypeInference = true;

					// we need to do some session configuration here, just resolving the promise is not enough
					var offset; 
					if (functionOffset !== undefined) {
			            offset = {line: functionOffset.line, ch: functionOffset.ch};
			        } else {
			            offset = session.getCursor();
			        }
			        session.setFunctionCallPos(offset);
					session.setFnType(resultArray);

					result.resolveWith(null, [ resultArray ]);
				} else {
					oldParameterHint(session, functionOffset).done(function () {
						result.resolveWith(this, arguments);
					}).fail(function () {
						result.reject(arguments);
					});
				}

				return result.promise(); 
			}; 
		});
	}

	exports.init = init;

});