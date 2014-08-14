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
	var TheseusTypeProvider 		= require("./src/TheseusTypeProvider");
	var TypeInformationStore 		= require("./src/TypeInformationStore"); 
	var TIUtils 					= require("./src/TIUtils");

	var inlineWidgetsByFunctionIdentifier = {};
	var currentDocument; 
	var hostEditor;

	function _init () {
		TIUtils.log("loading... "); 

		ExtensionUtils.loadStyleSheet(module, "main.less");

		TypeInformationStore.init();
		TypeInformationStore.setOptions({
			mergeAutomaticUpdatesConservatively: true
		});

		TheseusTypeProvider.init();
		JSDocTypeProvider.init();
		FunctionTracker.init();

		$(DocumentManger).on("currentDocumentChange", _currentDocumentChange);
		_currentDocumentChange(null, DocumentManger.getCurrentDocument());

		$(TypeInformationStore).on("didUpdateTypeInformation", _didUpdateTypeInformation); 
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

		currentDocument = newCurrentDocument;

		hostEditor = EditorManager.getCurrentFullEditor();

		if (currentDocument.getLanguage().getMode() !== "javascript") {
			return; 
		}

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

	AppInit.appReady(_init);

	exports.version = JSON.parse(require("text!package.json")).version;
});