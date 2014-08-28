 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var Resizer 			= brackets.getModule("utils/Resizer");
	var CodeMirror 			= brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");

	/**
	 * @constructor
	 * Renders a single test case. 
	 * @param {{title: string, isSuggestion: boolean}} options
	 */
	function TestCaseWidget (options) {
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

		setTimeout(this.codeMirror.refresh.bind(this.codeMirror), 1);
	}

	TestCaseWidget.prototype.constructor = TestCaseWidget; 

	TestCaseWidget.prototype.codeMirror = undefined;
	TestCaseWidget.prototype.$container = undefined;

	module.exports = TestCaseWidget;  
});