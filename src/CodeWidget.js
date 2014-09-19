 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var Resizer 			= brackets.getModule("utils/Resizer");
	var CodeMirror 			= brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");
	var DocumentManager 	= brackets.getModule("document/DocumentManager"); 

	/**
	 * @constructor
	 * Renders a single test case. 
	 * @param {{title: string, isSuggestion: boolean}} options
	 */
	function CodeWidget () {
		_.bindAll(this);

		this._$container = $(require("text!./templates/CodeWidget.html"));

		var $localEditorHolder = this.$container.find(".ti-editorHolder");
		this.codeMirror = new CodeMirror(function (element) {
			$localEditorHolder.html(element);
		}, {
			mode: "javascript",
            theme: "default",
            lineNumbers: true,
            lineWrapping: true,
			value: ""
		});

		this.codeMirror.on("changes", this.codeMirrorDidChange);

		this.$container.find('.ti-header').on("click", this.toggleSourceCodeVisible);
	}

	CodeWidget.prototype.constructor = CodeWidget; 

	Object.defineProperties(CodeWidget.prototype, {
		"$container": {
			get: function () { return this._$container; },
			set: function () { throw new Error("Cannot set $container"); }
		},
		"$addRemoveButton": {
			get: function () { return this.$container.find('.ti-button'); },
			set: function () { throw new Error("Cannot set $addRemoveButton"); }
		},
		"$caption": {
			get: function () { return this.$container.find(".ti-caption"); },
			set: function () { throw new Error("Cannot set $caption"); }
		}
	});

	CodeWidget.prototype.codeMirror 	= undefined;
	CodeWidget.prototype._$container 	= undefined;

	CodeWidget.prototype.codeMirrorDidChange = function() {
		DocumentManager.getCurrentDocument().isDirty = true;
	};

	CodeWidget.prototype.insertBefore = function(element, animate) {
		if (! animate) {
			this.$container.insertBefore(element); 
		} else {
			this.$container.height(0); 
			this.$container.insertBefore(element);

			this.codeMirror.on("update", function () {
				if (this.$container.find('.ti-header').outerHeight() >= 46) {
					//this is a pretty dirty hack to check if layout has happened. .ti-header has a
					//min-height of 46, so css has been applied if it's at least this big. 

					var height = 	this.$container.find('.ti-header').outerHeight() + 
									this.$container.find('.ti-editorHolder').outerHeight() +
									4; //padding-bottom

					this.$container.animate({ height: height }, 'fast', function () {
						this.$container.removeAttr('style');
					}.bind(this));

					this.codeMirror.off("update");
				}
			}.bind(this));
		}

		setTimeout(function () {
			this.codeMirror.refresh();
		}.bind(this), 1);
	};

	CodeWidget.prototype.remove = function() {
		this.$container.remove();
	};

	CodeWidget.prototype.toggleSourceCodeVisible = function(event) {
		this.$container.find('.ti-editorHolder').slideToggle('slow');
	};

	module.exports = CodeWidget;  
});