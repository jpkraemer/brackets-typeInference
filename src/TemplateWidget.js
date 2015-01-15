 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var Resizer 			= brackets.getModule("utils/Resizer");
	var CodeMirror 			= brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");
							  require("./lib/runmode");
	var DocumentManager 	= brackets.getModule("document/DocumentManager"); 
	var TIUtils				= require("./TIUtils");

	/**
	 * @constructor
	 * Renders a single test case. 
	 * @param {string} templateString The template to render
	 * @param {[array]} An array of arrays with suggestions, one for each placeholder in the template
	 */
	function TemplateWidget (templateString, suggestions) {
		_.bindAll(this);

		this._$container = $(require("text!./templates/CodeWidget.html"));
		//style this as suggestion
		// this.$container.addClass('ti-suggestion');
		this.$container.find(".ti-header").append($("<span />").addClass("ti-button ti-addButton"));
		this.$addRemoveButton.on("click", this.onAddButtonClicked);

		this.templateString = templateString; 
		this.suggestions = suggestions;

		this._renderTemplate();
	}

	TemplateWidget.prototype.constructor = TemplateWidget; 

	Object.defineProperties(TemplateWidget.prototype, {
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
		"templateString": {
			get: function () { return this._templateString; },
			set: function (newTemplateString) { this._templateString = newTemplateString; }
		},
		"suggestions": {
			get: function () { return this._suggestions; },
			set: function (newSuggestions) { this._suggestions = newSuggestions; }
		},
		"title": {
			get: function () { return this.$caption.text(); },
			set: function (newCaption) { this.$caption.text(newCaption); }
		},
		"code": {
			get: function () { 
				var $selects = this.$editorHolder.find("select"); 
				var selectedSuggestions = []; 
				$selects.each(function(index) {
					var suggestionId = $(this).attr("data-suggestionId");
					selectedSuggestions[suggestionId] = $(this).val();
				});

				return this.templateString.replace(/__(\d+)__/g, function (match, suggestionId) {
					return selectedSuggestions[Number(suggestionId)];
				});
			},
			set: function (newCode) { throw new Error("Cannot set code"); }
		}
	});

 	TemplateWidget.prototype.codeMirror 		= undefined;
	TemplateWidget.prototype._$container 		= undefined;
	TemplateWidget.prototype._templateString 	= undefined;
	TemplateWidget.prototype._suggestions 		= undefined;

	TemplateWidget.prototype.insertBefore = function(element, animate) {
		this._addToDom(function () {
			this.$container.insertBefore(element);
		}.bind(this), animate);
	};

	TemplateWidget.prototype.appendTo = function(element, animate) {
		this._addToDom(function () {
			this.$container.appendTo(element);
		}.bind(this), animate);
	};

	TemplateWidget.prototype._addToDom = function(insertionCallback, animate) {
		if (! animate) {
			insertionCallback();
		} else {
			this.$container.hide();
			insertionCallback();
			this.$container.slideDown('fast');
		}
	};

	TemplateWidget.prototype.remove = function() {
		this.$container.remove();
	};

	TemplateWidget.prototype._renderTemplate = function() {
		var $cm = $("<div />").addClass('CodeMirror cm-s-default CodeMirror-wrap'); 
		var $cmScroll = $("<div />").addClass('CodeMirror-scroll').appendTo($cm); 
		var $cmSizer = $("<div />").addClass('CodeMirror-sizer').css({ "margin-left": "60px" }).appendTo($cmScroll);
		var $cmLines = $("<div />").addClass('CodeMirror-lines').appendTo($cmSizer);
		var $cmCode = $("<div />").addClass('CodeMirror-code').appendTo($cmLines);

		var $lines = $("<div />");
		CodeMirror.runMode(this.templateString, "javascript", $lines.get(0)); 

		var self = this;
		
		$lines.find(".cm-variable").each(function (index) {
			var match = $(this).text().match(/__(\d+)__/);
			if (match !== null) {
				var suggestionId = Number(match[1]); 
				var suggestionsForId = self.suggestions[suggestionId];
				var $selectElement = $("<select />").attr("data-suggestionId", suggestionId); 
				for (var i = 0; i < suggestionsForId.length; i++) {
					var text = JSON.stringify(suggestionsForId[i]); 
					if (text.length > 50) {
						text = text.substr(0, 25) + "..." + text.substr(-25);
					}
					var $option = $('<option></option>')
						.attr("value", JSON.stringify(suggestionsForId[i]))
						.text(text);
					$selectElement.append($option);
				}
				
				$(this).html($selectElement);
			}
		});

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

	TemplateWidget.prototype.onAddButtonClicked = function(event) {
		$(this).trigger('addButtonClicked');
	};

	module.exports = TemplateWidget;  
});