 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var Resizer 			= brackets.getModule("utils/Resizer");
	var CodeMirror 			= brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");

	/**
	 * @constructor
	 * Renders a single test case. 
	 * @param {{title: string, isSuggestion: boolean}} options
	 * @param {Function} initializationDoneCallback called after the code mirror instance was properly initialized
	 */
	function TestCaseWidget (options, initializationDoneCallback) {
		_.bindAll(this);

		var testCaseTemplate = require("text!./templates/testCase.html");

		this.$container = $(Mustache.render(testCaseTemplate, options));

		var $localEditorHolder = this.$container.find(".ti-editorHolder");
		this.codeMirror = new CodeMirror(function (element) {
			$localEditorHolder.html(element);
		}, {
			mode: "javascript",
            theme: "default",
            lineNumbers: true,
            lineWrapping: true,
			value: require("text!./TestCasesPane.js")
		});
	}

	TestCaseWidget.prototype.constructor = TestCaseWidget; 

	TestCaseWidget.prototype.codeMirror = undefined;
	TestCaseWidget.prototype.$container = undefined;

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

	module.exports = TestCaseWidget;  
});