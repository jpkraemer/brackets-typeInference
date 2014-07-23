/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 						= brackets.getModule("thirdparty/lodash");
	var TypeInformationStore 	= require("./TypeInformationStore");

	/**
	 * Generates @param JSDoc entries from the given argument types 
	 * @param  {[Typespec]} argumentTypes
	 * @return {String}
	 */
	function _generateDocumentationForArgumentTypes(argumentTypes) {
		var paramTemplate = require("text!./templates/param-jsdoc.txt"); 
		var paramDocs = []; 

		for (var i = 0; i < argumentTypes.length; i++) {
			var type = argumentTypes[i];
			var templateValues = {
				name: type.name,
				type: _stringRepresentationForTypespec(type)
			};

			paramDocs.push(Mustache.render(paramTemplate, templateValues)); 
		}

		return paramDocs.join("\n");
	}

	/**
	 * Generates the type portion of a JSDoc @param entry
	 * @param  {Typespec} type
	 * @return {String}
	 */
	function _stringRepresentationForTypespec (type) {
		var result; 

		switch (type.type) {
			case "array": 
				result = "[" + _.map(type.spec, _stringRepresentationForTypespec).join(', ') + "]";
				break;
			case "object":
				result = "{ "; 
				result +=  _(type.spec)
								.mapValues(_stringRepresentationForTypespec)
								.pairs()
								.map(function (pair) { pair.join(": "); })
								.value()
								.join(", ");
				result += " }";
				break; 
			case "multiple":
				result = _.pluck(type.spec, "type").join(" or ");
				break; 
			default: 
				result = type.type;
		}

		if (type.hasOwnProperty("count")) {
			result += ":" + type.count; 
		}

		return result;
	}

	exports.generateDocumentationForArgumentTypes = _generateDocumentationForArgumentTypes;
});