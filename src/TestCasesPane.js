 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var Resizer 			= brackets.getModule("utils/Resizer");
	var CodeMirror 			= brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");
	var TestCaseWidget		= require("./TestCaseWidget");

	function TestCasesPane () {
		_.bindAll(this);

		this.$pane = $(require("text!./templates/TestCasesPane.html"));
		this.$scollView = this.$pane.find('.ti-scrollView');
		Resizer.makeResizable(this.$pane.get(0), Resizer.DIRECTION_HORIZONTAL, "left");

		this.$pane.find('.ti-roundAddButton').on('click', this.addTestButtonClicked); 

		this.addTestButtonClicked();

		this.$pane.insertBefore('#editor-holder > .CodeMirror');
		$('#editor-holder > .CodeMirror').width("50%");
	}

	TestCasesPane.prototype.constructor = TestCasesPane; 

	TestCasesPane.prototype.$pane = undefined;
	TestCasesPane.prototype.$scollView = undefined;
	TestCasesPane.prototype.codeMirror = undefined;

	TestCasesPane.prototype.testCaseTemplate = undefined; 


	TestCasesPane.prototype.addTestButtonClicked = function(event) {
		var newWidget = new TestCaseWidget({
			title: "This is a test case", 
			isSuggestion: false
		});

		newWidget.insertBefore(this.$pane.find('.ti-roundAddButton'));
		
		if (event !== undefined) {
			event.stopPropagation();
		}
	};


	module.exports = TestCasesPane;  
});