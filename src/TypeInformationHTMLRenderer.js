/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 				= require("./lib/lodash");
	var marked 			= require("./node/node_modules/marked/lib/marked");

	function typeToHTML (type, isArgument) {
		var singleArgumentTemplate = require("text!./templates/singleArgument.html");
		var templateValues = {
			isArgument: isArgument,
			name: type.name,
			type: typeSpecToHTML(type)
		};

		if (type.description !== undefined) {
			templateValues.description = marked(type.description);
		}

		return Mustache.render(singleArgumentTemplate, templateValues); 
	}

	/** 
	 * Convenience function to render an arbitrary markdown string to HTML. Used by the Doc Widget to show the general description
	 * @param {string} string The input string
	 * @return {string} HTML Markup
	 */ 	
	function markdownStringToHTML (string) {
		return marked(string); 
	}

	function typeSpecToHTML (type) {
		var result; 

		switch (type.type) {
			case "array": 
				result = "[" + _.map(type.spec, typeSpecToHTML).join(', ') + "]";
				break;
			case "object": 
				result = "{ "; 
				result +=  _.chain(type.spec)
								.mapValues(typeSpecToHTML)
								.pairs()
								.map(function (pair) { return pair.join(": "); })
								.value()
								.join(", ");
				result += " }";

				if (result.length > 100) {
					//TODO: tree view object
				}

				break; 
			case "multiple":
				result = "(" + _.pluck(type.spec, "type").join(" <em>or</em> ") + ")";
				break;
			default: 
				result = type.type.charAt(0).toUpperCase() + type.type.slice(1);
		}

		if (type.hasOwnProperty("count")) {
			result += "<em>("; 
			if (typeof type.count === "number"){
				result += type.count;
			} else {
				result += type.count.min + "-" + type.count.max;
			}

			result += "x)</em>";
		}

		return result;
	}

	exports.typeToHTML = typeToHTML;
	exports.typeSpecToHTML = typeSpecToHTML;
	exports.markdownStringToHTML = markdownStringToHTML; 

});