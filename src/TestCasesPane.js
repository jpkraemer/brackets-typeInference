 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var Resizer 			= brackets.getModule("utils/Resizer");
	var CodeMirror 			= brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");

	function TestCasesPane () {
		this.$pane = $(require("text!./templates/TestCasesPane.html"));
		this.$scollView = this.$pane.find('.ti-scrollView');
		Resizer.makeResizable(this.$pane.get(0), Resizer.DIRECTION_HORIZONTAL, "left");

		this.$pane.insertBefore('#editor-holder > .CodeMirror');
		$('#editor-holder > .CodeMirror').width("50%");

		this.testCaseTemplate = require("text!./templates/testCase.html");

		var $testTestCase = $(Mustache.render(this.testCaseTemplate, {
			title: "This is a test case", 
			isSuggestion: false
		}));

		var $localEditorHolder = $testTestCase.find(".ti-editorHolder");
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
		
		this.$scollView.prepend($testTestCase); 
	}

	TestCasesPane.prototype.constructor = TestCasesPane; 

	TestCasesPane.prototype.$pane = undefined;
	TestCasesPane.prototype.$scollView = undefined;
	TestCasesPane.prototype.codeMirror = undefined;

	TestCasesPane.prototype.testCaseTemplate = undefined; 

	module.exports = TestCasesPane;  
});