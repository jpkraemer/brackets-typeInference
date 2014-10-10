 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var Resizer 			= brackets.getModule("utils/Resizer");
	var CodeMirror 			= brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");
	var DocumentManager 	= brackets.getModule("document/DocumentManager"); 
	var TIUtils				= require("./TIUtils");

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
		this.codeMirror.on("keydown", this._onEditorKeyEvent);
		this.$container.on("keydown", this._onGeneralKeyEvent);

		this.$container.find('.ti-header').on("click", this.toggleSourceCodeVisible);
		this.$container.find('.ti-editorHolder').hide();

	}

	CodeWidget.prototype.constructor = CodeWidget; 

	Object.defineProperties(CodeWidget.prototype, {
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
		"code": {
			get: function () { 
				return this.codeMirror.getValue();
			},
			set: function (newCode) { 
				this.codeMirror.setValue(newCode);
			}
		}
	});

	CodeWidget.prototype.codeMirror 	= undefined;
	CodeWidget.prototype._$container 	= undefined;

	CodeWidget.prototype.codeMirrorDidChange = function() {
		DocumentManager.getCurrentDocument().isDirty = true;
	};

	CodeWidget.prototype.insertBefore = function(element, animate) {
		this._addToDom(function () {
			this.$container.insertBefore(element);
		}.bind(this), animate);
	};

	CodeWidget.prototype.appendTo = function(element, animate) {
		this._addToDom(function () {
			this.$container.appendTo(element);
		}.bind(this), animate);
	};

	CodeWidget.prototype._addToDom = function(insertionCallback, animate) {
		if (! animate) {
			insertionCallback();
		} else {
			this.$container.height(0); 
			insertionCallback();

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
		if (this.$editorHolder.is(":hidden")) {
			this.$editorHolder.height(0); 
			this.$editorHolder.show(); 

			this.codeMirror.on("update", function () {
				this.$editorHolder.animate({
					height: this.$editorHolder.find(".CodeMirror").outerHeight()
				}, 'fast' , function() {
					this.$editorHolder.removeAttr('style'); 
				}.bind(this));

				this.codeMirror.off("update");				
			}.bind(this));

			setTimeout(function () {
				this.codeMirror.refresh();
			}.bind(this), 1);
		} else {
			this.$editorHolder.slideUp('fast');
		}
	};

	CodeWidget.prototype.focus = function(direction) {
		if (this.$editorHolder.is(":visible")) {
			if (direction === "up") {
				var lastLineIndex = this.codeMirror.lineCount() - 1;
				this.codeMirror.setSelection({ line: lastLineIndex, ch: this.codeMirror.getLine(lastLineIndex).length });
			} else {
				this.codeMirror.setSelection({ line: 0, ch: 0 });
			}
			this.codeMirror.focus();
		} else {
			$(this).trigger("cursorShouldMoveToOtherWidget", direction);
		}
	};

	CodeWidget.prototype._onEditorKeyEvent = function(theEditor, event) {
		if (theEditor !== this.codeMirror) {
			TIUtils.log("_onEditorKeyEvent called with invalid editor");
			return; 
		}

		var cursorPos = this.codeMirror.getCursor();

        switch (event.keyCode) {
            case 38: //Arrow Up Key
                if (cursorPos.line === 0) {
                    $(this).trigger("cursorShouldMoveToOtherWidget", "up");
                }
                break;
            case 40:
                if (cursorPos.line === this.codeMirror.lineCount() - 1) {
                	$(this).trigger("cursorShouldMoveToOtherWidget", "down");
                }
                break;
        }
	};

	CodeWidget.prototype._onGeneralKeyEvent = function(event) {
		if (event.metaKey) {
			if (event.keyCode === 57) {
				//Command + 9
				if (this.$editorHolder.is(":visible")) {
					this.toggleSourceCodeVisible();
				}
			} else if (event.keyCode === 56) {
				//Command + 8
				if (this.$editorHolder.is(":hidden")) {
					this.toggleSourceCodeVisible();
				}
			}
		}
	};

	module.exports = CodeWidget;  
});