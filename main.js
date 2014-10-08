/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 							= require("./src/lib/lodash");
	var AppInit						= brackets.getModule("utils/AppInit");
	var DocumentationInlineEditor 	= require("./src/DocumentationInlineEditor");
	var DocumentManger				= brackets.getModule("document/DocumentManager");
	var EditorManager				= brackets.getModule("editor/EditorManager");
	var ExtensionUtils				= brackets.getModule("utils/ExtensionUtils");
	var FunctionTracker				= require("./src/FunctionTracker");
	var JSDocTypeProvider			= require("./src/JSDocTypeProvider");
	var JSUtils						= brackets.getModule("language/JSUtils");
	var ScopeManagerExtensions 		= require("./src/ScopeManagerExtensions");
	var SessionExtensions 			= require("./src/SessionExtensions");
	var TestCasesPane				= require("./src/TestCasesPane");
	var TestCaseCollectionManager	= require("./src/TestCaseCollectionManager");
	var TheseusAgentWrapper 		= require("./src/TheseusAgentWrapper");
	var TheseusTypeProvider 		= require("./src/TheseusTypeProvider");
	var TypeInformationStore 		= require("./src/TypeInformationStore"); 
	var TIUtils 					= require("./src/TIUtils");

	var EVENT_NAMESPACE = ".type-inference-main";

	var inlineWidgetsByFunctionIdentifier = {};
	var currentDocument; 
	var hostEditor;
	var testCasesPane;

	function _init () {
		TIUtils.log("loading... "); 

		ExtensionUtils.loadStyleSheet(module, "main.less");

		TypeInformationStore.init();
		TypeInformationStore.setOptions({
			mergeAutomaticUpdatesConservatively: true
		});

		TheseusAgentWrapper.init();
		TheseusTypeProvider.init();
		JSDocTypeProvider.init();
		FunctionTracker.init();
		TestCaseCollectionManager.init();

		//initialize overwrites
		ScopeManagerExtensions.init();
		SessionExtensions.init();

		$(DocumentManger).on("currentDocumentChange", _currentDocumentChange);
		_currentDocumentChange(null, DocumentManger.getCurrentDocument());

		$(TypeInformationStore).on("didUpdateTypeInformation", _didUpdateTypeInformation); 

		testCasesPane = new TestCasesPane();
	}

	/**
	 * Currently we set inline editors up here. This might move, not sure yet what's the best place
	 * @param  {jQuery Event} evt
	 * @param  {Document} currentDocument
	 * @param  {Document} previousDocument
	 */
	function _currentDocumentChange (evt, newCurrentDocument, previousDocument) {
		_.forOwn(inlineWidgetsByFunctionIdentifier, function (editor) {
			editor.close();
		});
		inlineWidgetsByFunctionIdentifier = {};

		if (hostEditor !== undefined) { 
			hostEditor._codeMirror.off(EVENT_NAMESPACE);
		}

		currentDocument = newCurrentDocument;

		if (currentDocument.getLanguage().getMode() !== "javascript") {
			return; 
		}

		hostEditor = EditorManager.getCurrentFullEditor();
		hostEditor._codeMirror.on("keydown", _onEditorKeyEvent);

		TypeInformationStore.functionIdentifiersForFile(currentDocument.file.fullPath).done(function (functionIdentifiers) {
			var functionLocations = FunctionTracker.functionLocationsInCurrentDocument(); 
			_.forOwn(functionLocations, function (functionLocation, functionIdentifier) {
				var index = functionIdentifiers.indexOf(functionIdentifier);

				if (index !== -1) {
					inlineWidgetsByFunctionIdentifier[functionIdentifier] = new DocumentationInlineEditor(functionIdentifier, hostEditor, functionLocation.commentRange.start, functionLocation.commentRange.end);
				}
			});
		});
	}

	function _didUpdateTypeInformation (evt, newDoc) {
		if ((inlineWidgetsByFunctionIdentifier[newDoc.functionIdentifier] === undefined) && 
			(newDoc.file === currentDocument.file.fullPath)) {

			var functionLocation = FunctionTracker.functionLocationForFunctionIdentifier(newDoc.functionIdentifier);
			if (functionLocation !== undefined) {
				inlineWidgetsByFunctionIdentifier[newDoc.functionIdentifier] = new DocumentationInlineEditor(newDoc.functionIdentifier, hostEditor, functionLocation.commentRange.start, functionLocation.commentRange.end);
			}
		}
	}

    function _onEditorKeyEvent (theEditor, event) { 	
        //sanity checks
        if ((event.type !== "keydown") || (theEditor !== EditorManager.getCurrentFullEditor()._codeMirror)) {
            TIUtils.log("_onEditorKeyEvent in main.js callback called with invalid event or unknown editor");
            return;
        }

        var cursorPos = theEditor.getCursor();
        var inlineWidget; 
        var fromBelow;

        switch (event.keyCode) {
            case 38: 
                //Arrow Key Up
     			inlineWidget = _.find(inlineWidgetsByFunctionIdentifier, function (inlineWidget) {
     				var range = inlineWidget.getCurrentRange(); 
     				return (range.end.line === cursorPos.line - 1);
     			});
     			fromBelow = true;
                break;
            case 40:
                //Arrow Key Down
                inlineWidget = _.find(inlineWidgetsByFunctionIdentifier, function (inlineWidget) {
     				var range = inlineWidget.getCurrentRange(); 
     				return (range.start.line === cursorPos.line + 1);
     			});
     			fromBelow = false;
                break;
        }

        if (inlineWidget !== undefined) {
			inlineWidget.focus(fromBelow);
		}
    }

	AppInit.appReady(_init);

	exports.version = JSON.parse(require("text!package.json")).version;
});