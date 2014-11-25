/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 				= require("./lib/lodash");
	var marked 			= require("./node/node_modules/marked/lib/marked");

	/**
	 * Render a single typespec
	 * @param  {Typespec}  type
	 * @param  {Boolean} isArgument
	 * @return {string} acutal HTML
	 */
	function typeToHTML (type, isArgument) {
		var singleArgumentTemplate = require("text!./templates/singleArgument.html");
		var templateValues = {
			isArgument: isArgument,
			name: (type.name !== undefined) ? type.name : "<i>unnamed</i>",
			type: typeSpecToHTML(type.type)
		};

		if (type.description !== undefined) {
			templateValues.description = marked(type.description);
		}

		return Mustache.render(singleArgumentTemplate, templateValues); 
	}

	function pendingChangesToHTML (pendingChanges, mergedChange, isArgument) {
		var pendingChangesTemplate = require("text!./templates/changesTable.html");
		var templateValues = {
			isArgument: isArgument, 
			name: mergedChange.name,
			type: typeSpecToHTML(mergedChange.type)
		};

		templateValues.individualChanges = _.map(pendingChanges, function (pendingChange, theseusInvocationId) {
			var result = {
				isArgument: isArgument, 
				name: pendingChange.name,
				theseusInvocationId: theseusInvocationId,
				type: typeSpecToHTML(pendingChange.type)
			};

			if (pendingChange.description !== undefined) { 
				result.description = pendingChange.description;
			}

			return result;
		});

		return Mustache.render(pendingChangesTemplate, templateValues);
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
				if (type.name !== undefined) {
					result = type.name;
				} else {
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
				}

				break; 
			case "multiple":
				result = "(" + _.pluck(type.spec, "type").join(" <em>or</em> ") + ")";
				break;
			default: 
				result = type.type.charAt(0).toUpperCase() + type.type.slice(1);
		}

		if ((type.hasOwnProperty("count")) && (type.count !== undefined)) {
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
	exports.pendingChangesToHTML = pendingChangesToHTML;
	exports.markdownStringToHTML = markdownStringToHTML; 

});