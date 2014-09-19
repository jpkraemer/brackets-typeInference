 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var CodeMirror 			= brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");
	var CodeWidget			= require("./CodeWidget");
	var DocumentManager 	= brackets.getModule("document/DocumentManager"); 
	var Resizer 			= brackets.getModule("utils/Resizer");
	var TestCasesProvider	= require("./TestCasesProvider");

	/**
	 * @constructor
	 * Renders a single test case. 
	 * @param {{title: string, isSuggestion: boolean}} options
	 */
	function TestCaseWidget (testCase) {
		CodeWidget.call(this);

		_.bindAll(this);

		//add missing html
		this.$container.find(".ti-headerLine").prepend($("<span />").addClass("ti-testStatusIndicator"));
		this.$container.find(".ti-header").append($("<span />").addClass("ti-button ti-addButton"));

		//configure behavior
		this.testCase = testCase;
		$(TestCasesProvider).on("updatedTestResults", this.didUpdateTestResults);
	}

	TestCaseWidget.prototype = Object.create(CodeWidget.prototype);
	TestCaseWidget.prototype.constructor = TestCaseWidget; 
	TestCaseWidget.prototype.parentClass = CodeWidget.prototype;

	Object.defineProperties(TestCaseWidget.prototype, {
		"$statusIndicator": {
			get: function () { return this.$container.find(".ti-testStatusIndicator"); },
			set: function () { throw new Error("Cannot set $statusIndicator"); }
		},
		"$addRemoveButton": {
			get: function () { return this.$container.find(".ti-header .ti-button"); },
			set: function () { throw new Error("Cannot set $statusIndicator"); }
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
			set: function (newTestCase) { 
				this._testCase = newTestCase; 

				this.codeMirror.setValue(this._testCase.code);
				this.$caption.text(this._testCase.title);
				this.isSuggestion = this._testCase.isSuggestion;
			}
		}
	});

	TestCaseWidget.prototype._isSuggestion 	= undefined;

	TestCaseWidget.prototype.didUpdateTestResults = function(event, results) {
		if (results[this.testCase.functionIdentifier]) {
			var testResult = _.find(results[this.testCase.functionIdentifier], { id: this.testCase.id });
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