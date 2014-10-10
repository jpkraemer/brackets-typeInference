 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var Resizer 			= brackets.getModule("utils/Resizer");
	var CodeMirror 			= brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");
							  require("./lib/runmode");
	var TheseusAgentWrapper	= require("./TheseusAgentWrapper");
	var TIUtils				= require("./TIUtils");

	/**
	 * @constructor
	 * Renders a single test case. 
	 * @param {string} templateString The template to render
	 * @param {[array]} An array of arrays with suggestions, one for each placeholder in the template
	 */
	function PreviousExecutionsWidget (functionIdentifier) {
		_.bindAll(this);

		this._$container = $(require("text!./templates/CodeWidget.html"));
		this.$callsTableWrapper = $("<div />").addClass('ti-callsTableWrapper');
		this.$callsTableWrapper.insertAfter(this.$container.find(".ti-header"));

		this.title = "should return correct result";
		this.templateString = require("text!./templates/returnValueTest.txt");
		this.functionIdentifier = functionIdentifier;

		this._theseusRegistrationId = TheseusAgentWrapper.registerForTheseusUpdates({ nodeId: this.functionIdentifier }, this._updateTheseusInformation);
	}

	PreviousExecutionsWidget.prototype.constructor = PreviousExecutionsWidget; 

	Object.defineProperties(PreviousExecutionsWidget.prototype, {
		"$container": {
			get: function () { return this._$container; },
			set: function () { throw new Error("Cannot set $container"); }
		},
		"$editorHolder": {
			get: function () { return this.$container.find('.ti-editorHolder');	},
			set: function () { throw new Error("Cannot set $editorHolder"); }	
		},
		"$addRemoveButton": {
			get: function () { return this.$container.find('.ti-button'); },
			set: function () { throw new Error("Cannot set $addRemoveButton"); }
		},
		"$caption": {
			get: function () { return this.$container.find(".ti-caption"); },
			set: function () { throw new Error("Cannot set $caption"); }
		},
		"$callsTableWrapper": {
			get: function () { return this._$callsTableWrapper; },
			set: function ($newCallsTableWrapper) { this._$callsTableWrapper = $newCallsTableWrapper; }
		},
		"templateString": {
			get: function () { return this._templateString; },
			set: function (newTemplateString) { this._templateString = newTemplateString; }
		},
		"functionIdentifier": {
			get: function () { return this._functionIdentifier; },
			set: function (newFunctionIdentifier) { this._functionIdentifier = newFunctionIdentifier; }
		},
		"title": {
			get: function () { return this.$caption.text(); },
			set: function (newCaption) { this.$caption.text(newCaption); }
		}, 
		"suggestions": {
			get: function () { return this._suggestions; }, 
			set: function (newSuggestions) {
				this._suggestions = newSuggestions; 
				this._updateTemplate(); 
				this._renderSuggestions();
			}
		}
	});

 	PreviousExecutionsWidget.prototype.codeMirror 				= undefined;
	PreviousExecutionsWidget.prototype._$container 				= undefined;
	PreviousExecutionsWidget.prototype._templateString 			= undefined;
	PreviousExecutionsWidget.prototype._preparedTemplateString 	= undefined;
	PreviousExecutionsWidget.prototype._theseusRegistrationId 	= undefined;
	PreviousExecutionsWidget.prototype._suggestions 			= undefined;

	PreviousExecutionsWidget.prototype.insertBefore = function(element, animate) {
		this._addToDom(function () {
			this.$container.insertBefore(element);
		}.bind(this), animate);
	};

	PreviousExecutionsWidget.prototype.appendTo = function(element, animate) {
		this._addToDom(function () {
			this.$container.appendTo(element);
		}.bind(this), animate);
	};

	PreviousExecutionsWidget.prototype._addToDom = function(insertionCallback, animate) {
		if (! animate) {
			insertionCallback();
		} else {
			this.$container.hide();
			insertionCallback();
			this.$container.slideDown('fast');
		}
	};

	PreviousExecutionsWidget.prototype.remove = function() {
		TheseusAgentWrapper.unregisterForTheseusUpdates(this._theseusRegistrationId);

		this.$container.remove();
	};

	PreviousExecutionsWidget.prototype.codeForSuggestionIndex = function(suggestionIndex) {

		var stringReplaceMatchWithString = function (string, match, newString) {
			return string.slice(0, match.index) + newString + string.slice(match.index + match[0].length);
		};

		var code = this._preparedTemplateString; 
		var suggestion = this.suggestions[suggestionIndex]; 
		var argumentsByPlaceholderName = _.indexBy(suggestion.arguments, function (argument, index) {
			return (argument.name || index); 
		});

		// var placeholderRegex = ;
		var match; 

		while ((match = /__(.+?)__/g.exec(code)) !== null) {
			if (match[1] === "returnValue") {
				code = stringReplaceMatchWithString(code, match, suggestion.returnValue);
			} else {
				var argument = argumentsByPlaceholderName[match[1]]; 
				var value = (argument !== undefined) ? argument.value : "undefined"; 
				code = stringReplaceMatchWithString(code, match, value);
			}
		}

		return code;
	};

	PreviousExecutionsWidget.prototype.onAddButtonClicked = function(suggestionIndex, event) {
		$(this).trigger("addButtonClicked", [ suggestionIndex ]); 
	};

	PreviousExecutionsWidget.prototype._updateTemplate = function() {
		var functionIdentifierSegments = this.functionIdentifier.split("-");
		var functionIndex = functionIdentifierSegments.lastIndexOf("function");
		var functionName = functionIdentifierSegments.slice(functionIndex + 1, -1).join("-");
		
		var functionCall = functionName + "("; 
		var suggestionWithMaxArguments = _.max(this.suggestions, function (suggestion) {
			return suggestion.arguments.length;
		});

		var argumentPlaceholders = _.map(suggestionWithMaxArguments.arguments, function (argument, index) {
			return "__" + (argument.name || index) + "__";
		});

		functionCall += argumentPlaceholders.join(", ");
		functionCall += ")";

 		this._preparedTemplateString = this.templateString.replace("__name__", functionCall);

 		this._renderTemplate();
	};

	PreviousExecutionsWidget.prototype._renderTemplate = function() {
		this.$editorHolder.empty();

		var $cm = $("<div />").addClass('CodeMirror cm-s-default CodeMirror-wrap'); 
		var $cmScroll = $("<div />").addClass('CodeMirror-scroll').appendTo($cm); 
		var $cmSizer = $("<div />").addClass('CodeMirror-sizer').css({ "margin-left": "60px" }).appendTo($cmScroll);
		var $cmLines = $("<div />").addClass('CodeMirror-lines').appendTo($cmSizer);
		var $cmCode = $("<div />").addClass('CodeMirror-code').appendTo($cmLines);

		var $lines = $("<div />");
		CodeMirror.runMode(this._preparedTemplateString, "javascript", $lines.get(0)); 

		var lines = this.templateString.split("\n");
		var linesHTML = $lines.html().split("\n");
		$lines.empty();
		_.each(linesHTML, function(el, index) {
			var whiteSpaceMatch = el.match(/^(\s+)/);
			el = el.replace(/^\s+/, "");
			var $linePre = $("<pre />").appendTo($("<div />")).html(el);
			
			if (whiteSpaceMatch !== null) {
				$linePre.prepend($("<span />").addClass('cm-tab').text(whiteSpaceMatch[1].replace(/\t/g, "    ")));
			}

			$linePre.parent().appendTo($lines);
		});

		$lines.appendTo($cmSizer);
		this.$editorHolder.append($cm);
	};

	PreviousExecutionsWidget.prototype._renderSuggestions = function() {
		this.$callsTableWrapper.empty();

		var $callsTable = $("<table />");

		var suggestionWithMaxArguments = _.max(this.suggestions, function (suggestion) {
			return suggestion.arguments.length;
		});
		var argumentCount = suggestionWithMaxArguments.arguments.length;

		for (var i = 0; i < this.suggestions.length; i++) {
			var suggestion = this.suggestions[i];

			var $tableRow = $("<tr />").appendTo($callsTable); 

			for (var j = 0; j < argumentCount; j++) {
				var argument = suggestion.arguments[j];
				var $td = $("<td />").appendTo($tableRow);
				if (argument !== undefined) {
					CodeMirror.runMode(argument.value, "javascript", $td.get(0));
				}				
			}
			
			$("<td />").text(suggestion.returnValue).appendTo($tableRow);

			var $addButton = $("<a />").text("Add Testcase").on("click", this.onAddButtonClicked.bind(this, i));
			$("<td />").append($addButton).appendTo($tableRow);
		}

		$callsTable.appendTo(this.$callsTableWrapper);
	};


	PreviousExecutionsWidget.prototype._updateTheseusInformation = function(results) {
		var newSuggestions = [];
		
		var argumentMappingFunction = function (argument) {
			return {
				name: argument.name,
				value: argument.value.json
			};
		};

		for (var i = 0; i < results.length; i++) {
			var result = results[i]; 
			var suggestion = {
				arguments: _.map(result.arguments, argumentMappingFunction),
				returnValue: result.returnValue.json
			};
			newSuggestions.push(suggestion);
		}

		this.suggestions = newSuggestions;
	};

	module.exports = PreviousExecutionsWidget;  
});