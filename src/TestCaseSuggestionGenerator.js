/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 							= require("./lib/lodash");
	var TestCaseCollection 			= require("./TestCaseCollection");
	var TypeInformationCollection 	= require("./TypeInformationCollection");

	var returnValueTestTemplate 	= require("text!./templates/returnValueTest.txt");
	var exceptionTestTemplate 		= require("text!./templates/exceptionTest.txt");

	function getTestSuggestionsForFunctionIdentifier (functionIdentifier) {
		var getTemplateStringForBaseTemplate = function (template) {
			var functionCall = functionName + "(";
			if (typeInformation.argumentTypes !== undefined) {
				functionCall += typeInformation.argumentTypes.map(function(el, index) {
					return "__" + index + "__"; 
				}).join(", ");
			}
			functionCall += ")";
			template = template.replace(/__name__/, functionCall); 
			template = template.replace(/__returnValue__/, "undefined");
			return template;
		};

		var resultPromise = $.Deferred();
		var typeInformation = TypeInformationCollection.typeInformationForFunctionIdentifier(functionIdentifier);
		
		if (typeInformation) {
			var functionIdentifierSegments = typeInformation.functionIdentifier.split("-");
			var functionIndex = functionIdentifierSegments.lastIndexOf("function");
			var functionName = functionIdentifierSegments.slice(functionIndex + 1, -1).join("-");

			var result = []; 
			var argumentSuggestions = _suggestArgumentValues(typeInformation);
			if (typeInformation.returnType !== undefined) {
				result.push({
					title: "should return correct result",
					templateString: getTemplateStringForBaseTemplate(returnValueTestTemplate),
					argumentSuggestions: argumentSuggestions
				});
			}

			result.push({
				title: "should not throw exception for valid input",
				templateString: getTemplateStringForBaseTemplate(exceptionTestTemplate),
				argumentSuggestions: argumentSuggestions
			});

			resultPromise.resolve(result);
		} else {
			resultPromise.reject("No type information found");
		}

		return resultPromise.promise();		
	}

	/**
	 * This method generates suggested test cases based on a given type information 
	 * Note that the test cases suggested here are by design and not set in stone.
	 * @param  {TypeInformation} typeInformation 
	 * @return {[TestCase]}
	 */
	function _suggestArgumentValues (typeInformation) {
		var result = []; 

		if (typeInformation.argumentTypes === undefined) {
			return result;
		}

		for (var i = 0; i < typeInformation.argumentTypes.length; i++) {
			var argumentType = typeInformation.argumentTypes[i]; 
			var argumentSuggestion = []; 

			switch (argumentType.type) {
				case "number": 
					argumentSuggestion = argumentSuggestion.concat([ 0, 1, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY ]); 
					break; 
				case "string": 
					argumentSuggestion = argumentSuggestion.concat([ "", "testString" ]);
					break; 
				case "array":
					argumentSuggestion.push([]);
					if (_.isEmpty(argumentSuggestion.spec)) {
						argumentSuggestion.push([ 0, "a", 2, "b", 4, "c", 6, "d", 8, "e" ]); 
					} else if (argumentSuggestion.spec.length === 1) {
						switch (argumentSuggestion.spec[0].type) {
							case "string": 
								argumentSuggestion.push([ "a", "b", "c", "d", "e", "f" ]); 
								break; 
							case "number":
								argumentSuggestion.push([ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 ]);
								break;
						}
					}
					break;
				case "object":
					argumentSuggestion.push({});
					break; 
			}

			if (argumentType.optional === true) {
				argumentSuggestion.push(undefined);
			}

			result[i] = argumentSuggestion;
		}

		return result;
	}

	exports.getTestSuggestionsForFunctionIdentifier = getTestSuggestionsForFunctionIdentifier;

});