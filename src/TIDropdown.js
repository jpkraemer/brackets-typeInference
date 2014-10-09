/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ = require("./lib/lodash");

	function TIDropdown (allowAdd, allowEdit) {
		_.bindAll(this);

		this.$container = $("<span />").addClass("ti-dropdown");
		this.$textContainer = $("<span />").appendTo(this.$container);
		this.$popup = $("<div />").hide().appendTo(this.$container);

		this.content 	= [];
		this.allowAdd 	= (allowAdd !== undefined) ? allowAdd : true;
		this.allowEdit 	= (allowEdit !== undefined) ? allowEdit : true;

		this.$textContainer.on("click", this._onTextContainerClick);
		this.$textContainer.on("blur", this._onTextContainerBlur);

		$(document).on("click", this._onDocumentClick);
	}

	TIDropdown.prototype.constructor = TIDropdown;

	TIDropdown.prototype.$container 		= undefined;
	TIDropdown.prototype.$textContainer		= undefined;
	TIDropdown.prototype.$popup				= undefined;
	TIDropdown.prototype._content 			= undefined;
	TIDropdown.prototype._selectionIndex 	= undefined;
	TIDropdown.prototype.allowAdd			= undefined;
	TIDropdown.prototype._allowEdit			= undefined;

	Object.defineProperties(TIDropdown.prototype, {
		"value": {
			get: function () { return this._selection.value; },
			set: function (value) { 
				var index = _.findIndex(this._content, { value: value });
				this.selectionIndex = (index > -1) ? index : 0;
			}
		}, 
		"content": {
			get: function () { return this._content; },
			set: function (newContent) { 
				this._content = newContent; 
				this.selectionIndex = 0;
				this._updatePopup();
			}
		},
		"selectionIndex": {
			get: function () { return this._selectionIndex; },
			set: function (newSelectionIndex) {
				if ((newSelectionIndex >= 0) && (newSelectionIndex < this.content.length)) {
					this._selectionIndex = newSelectionIndex;
				}	
				this._updateTextContainer();			
			}
		},
		"allowEdit": {
			get: function () { return this._allowEdit; },
			set: function (allowEdit) {
				this._allowEdit = allowEdit;
				this.$textContainer.attr('contenteditable', allowEdit ? 'true' : 'false'); 
			}
		},
		"_selection": {
			get: function () { return this.content[this.selectionIndex] || { text: undefined, value: undefined }; },
			set: function () { throw new Error("Cannot set _selection"); }
		}
	});

	TIDropdown.prototype.appendTo = function ($element) {
		this.$container.appendTo($element);
	};

	TIDropdown.prototype._onTextContainerClick = function (event) {
		var rightEdge = this.$textContainer.offset().left + this.$textContainer.width() - 17;
		if ((! this.allowEdit) || (rightEdge > event.pageX)) {
			this.$popup.toggle();
		}		
		event.stopPropagation();
	};

	TIDropdown.prototype._onDocumentClick = function(event) {
		this.$popup.hide();
	};

	TIDropdown.prototype._onTextContainerBlur = function (event) {
		var newText = this.$textContainer.text();
		if (newText !== this._selection.text) {
			this._selection.text = newText; 
			this._updatePopup();

			$(this).trigger("edit", [ this._selection ]);
		}
	};

	TIDropdown.prototype._updateTextContainer = function () {
		this.$textContainer.text(this._selection.text || "");
	};

	TIDropdown.prototype._onUlClick = function(event) {
		var $a = $(event.target); 
		this.value = $a.data("value"); 
		$(this).trigger("change", [ this.value ]);
	};

	TIDropdown.prototype._updatePopup = function () {
		this.$popup.empty(); 

		for (var i = 0; i < this.content.length; i++) {
			var entry = this.content[i];

			this.$popup.append(
				$("<a />").text(entry.text).data("value", entry.value).on("click", this._onUlClick)
			);
		}

		if (this.allowAdd) {
			var $a = $("<a />").text("Add...").on("click", this._onAddClicked);
			this.$popup.append($a);
		}
	};

	TIDropdown.prototype._onAddClicked = function(event) {
		var $a = $(event.target);
		$a.empty();
		var $input = $("<input />").on("keypress", this._onAddFormKeypress); 
		$a.append($input);
		$input.focus();

		event.stopPropagation();
	};

	TIDropdown.prototype._onAddFormKeypress = function(event) {
		if (event.keyCode === 13) { // === "Enter"
			var value = $(event.target).val();
			var newEntry = {
				text: value, 
				value: value
			};

			this._content.push(newEntry);
			this.selectionIndex = this._content.length - 1;

			this.$popup.hide();
			this._updatePopup(); 

			$(this).trigger("add", [ newEntry ]);

			event.preventDefault();
		}
	};

	module.exports = TIDropdown;

});