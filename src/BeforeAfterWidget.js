 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var CodeWidget			= require("./CodeWidget");
	var DocumentManager 	= brackets.getModule("document/DocumentManager"); 
	var TestCasesProvider	= require("./TestCasesProvider");

	/**
	 * @constructor
	 * 
	 * @param {string} code
	 * @param {string} mode Can be "before" or "after"
	 */
	function BeforeAfterWidget (code, mode) {
		CodeWidget.call(this);

		_.bindAll(this);

		this.code = code;
		this.mode = mode;
		if (mode === "beforeAll") {
			this.$caption.text("Spec Closure");
		} else {
			this.$caption.text(mode + "Each");
		}
		this.$container.find(".ti-header").addClass('ti-caption-immutable');
	}

	BeforeAfterWidget.prototype = Object.create(CodeWidget.prototype);
	BeforeAfterWidget.prototype.constructor = BeforeAfterWidget; 
	BeforeAfterWidget.prototype.parentClass = CodeWidget.prototype;

	BeforeAfterWidget.prototype._mode = undefined;

	Object.defineProperties(BeforeAfterWidget.prototype, {
		"mode": {
			get: function () { return this._mode; },
			set: function (value) {
				if (this._mode === value) {
					return; 
				}

				this._mode = value;
			}
		}
	});

	BeforeAfterWidget.prototype.toggleSourceCodeVisible = function(event) {
		if ((this.codeMirror.hasFocus()) && (this.$editorHolder.is(":visible"))) {
			if (this.mode === "before") {
				$(this).trigger("cursorShouldMoveToOtherWidget", "down");
			} else {
				$(this).trigger("cursorShouldMoveToOtherWidget", "up");
			}
		}

		CodeWidget.prototype.toggleSourceCodeVisible.apply(this, arguments);
	};

	module.exports = BeforeAfterWidget;  
});