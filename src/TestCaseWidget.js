 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var Resizer 			= brackets.getModule("utils/Resizer");
	var CodeMirror 			= brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");
	var DocumentManager 	= brackets.getModule("document/DocumentManager"); 
	var TestCasesProvider	= require("./TestCasesProvider");

	/**
	 * @constructor
	 * Renders a single test case. 
	 * @param {{title: string, isSuggestion: boolean}} options
	 */
	function TestCaseWidget (testCase) {
		_.bindAll(this);

		this.testCase = testCase;
		$(TestCasesProvider).on("updatedTestResults", this.didUpdateTestResults);

		var testCaseTemplate = require("text!./templates/testCase.html");
		this._$container = $(Mustache.render(testCaseTemplate, testCase));

		var $localEditorHolder = this.$container.find(".ti-editorHolder");
		this.codeMirror = new CodeMirror(function (element) {
			$localEditorHolder.html(element);
		}, {
			mode: "javascript",
            theme: "default",
            lineNumbers: true,
            lineWrapping: true,
			value: testCase.code
		});

		this.codeMirror.on("changes", this.codeMirrorDidChange);

		this.$container.find('.ti-header').on("click", this.toggleSourceCodeVisible);

		this.isSuggestion = testCase.isSuggestion;
	}

	TestCaseWidget.prototype.constructor = TestCaseWidget; 

	Object.defineProperties(TestCaseWidget.prototype, {
		"$container": {
			get: function () { return this._$container; },
			set: function () { throw new Error("Cannot set $container"); }
		},
		"$addRemoveButton": {
			get: function () { return this.$container.find('.ti-button'); },
			set: function () { throw new Error("Cannot set $addRemoveButton"); }
		},
		"isSuggestion": {
			get: function () { return this._isSuggestion; },
			set: function (value) {
				if (this._isSuggestion === value) {
					return; 
				}

				this._isSuggestion = value;
				if (this._isSuggestion === true) {
					this.$container.addClass('ti-suggestion');
					this.$addRemoveButton.removeClass('ti-removeButton');
					this.$addRemoveButton.addClass('ti-addButton');
				} else {
					this.$container.removeClass('ti-suggestion');
					this.$addRemoveButton.removeClass('ti-addButton');
					this.$addRemoveButton.addClass('ti-removeButton');
				}
			}
		},
		"testCase": {
			get: function () { 
				this._testCase.code = this.codeMirror.getValue();
				this._testCase.title = this.$container.find(".ti-caption").text();

				return this._testCase; 
			},
			set: function (newTestCase) { this._testCase = newTestCase; }
		}
	});

	TestCaseWidget.prototype.codeMirror 	= undefined;
	TestCaseWidget.prototype._$container 	= undefined;
	TestCaseWidget.prototype._isSuggestion 	= undefined;

	TestCaseWidget.prototype.codeMirrorDidChange = function() {
		DocumentManager.getCurrentDocument().isDirty = true;
	};

	TestCaseWidget.prototype.insertBefore = function(element) {
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

		setTimeout(function () {
			this.codeMirror.refresh();
		}.bind(this), 1);
	};

	TestCaseWidget.prototype.remove = function() {
		this.$container.remove();
	};

	TestCaseWidget.prototype.toggleSourceCodeVisible = function(event) {
		// this.$container.height(this.$container.outerHeight());

		this.$container.find('.ti-editorHolder').slideToggle('slow');
	};

	TestCaseWidget.prototype.didUpdateTestResults = function(event, results) {
		if (results[this.testCase.functionIdentifier]) {
			var testResult = _.find(results[this.testCase.functionIdentifier], { title: this.testCase.title });
			if (testResult !== undefined) {
				var $statusIndicator = this.$container.find(".ti-testStatusIndicator");
				if (testResult.success) {
					$statusIndicator.removeClass('ti-testStatusFailed');
				} else {
					$statusIndicator.addClass('ti-testStatusFailed');
				}
			}
		}
	};

	module.exports = TestCaseWidget;  
});