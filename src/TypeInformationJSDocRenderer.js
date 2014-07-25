/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 				= require("./lib/lodash");

	/**
	 * Generates @param JSDoc entries from the given argument types 
	 * @param  {Typespec} argumentTypes
	 * @return {String}
	 */
	function typeSpecToJSDocParam(type) {
		var paramTemplate = require("text!./templates/param-jsdoc.txt"); 
		var templateValues = {
			name: type.name,
			type: _jsDocTypeStringForTypespec(type),
			description: type.description
		};

		return Mustache.render(paramTemplate, templateValues); 
	}

	/**
	 * Generates the type portion of a JSDoc @param entry
	 * @param  {Typespec} type
	 * @return {String}
	 */
	function _jsDocTypeStringForTypespec (type) {
		var result; 

		switch (type.type) {
			case "array": 
				result = "Array.<" + _.map(type.spec, _jsDocTypeStringForTypespec).join(', ') + ">";
				break;
			case "object":
				result = "{ "; 
				result +=  _.chain(type.spec)
								.mapValues(_jsDocTypeStringForTypespec)
								.pairs()
								.map(function (pair) { return pair.join(": "); })
								.value()
								.join(", ");
				result += " }";
				break; 
			case "multiple":
				result = "(" + _.pluck(type.spec, "type").join("|") + ")";
				break; 
			default: 
				result = type.type;
		}

		if (type.hasOwnProperty("count")) {
			result += ":" + type.count; 
		}

		return result;
	}

	exports.typeSpecToJSDocParam = typeSpecToJSDocParam;

});