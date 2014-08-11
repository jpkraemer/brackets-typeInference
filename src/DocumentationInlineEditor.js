/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

    var _                              = require("./lib/lodash");
    var AnimationUtils                 = brackets.getModule("utils/AnimationUtils");
    var Async                          = brackets.getModule("utils/Async");
    var CodeMirror                     = brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");
    var Editor                         = brackets.getModule("editor/Editor").Editor;
	var InlineWidget 			       = brackets.getModule("editor/InlineWidget").InlineWidget;
    var TypeInformationHTMLRenderer    = require("./TypeInformationHTMLRenderer");
    var TypeInformationJSDocRenderer   = require("./TypeInformationJSDocRenderer");
    var TypeInformationStore           = require("./TypeInformationStore");
    var TIUtils                        = require("./TIUtils");

    var DOC_PART_ORDER                 = ["description", "parameters", "return"];

    /**
     * We add functionality to render inline widgets above the inserted line here. 
     * Therefor, we copy the original addInlineWidget methods from the editor and change them to use the above: true option.
     * It is a terrible hack and should be avoided in the future.
     */
    Editor.prototype.addInlineWidgetAbove = function (pos, inlineWidget, scrollLineIntoView) {
        var self = this,
            queue = this._inlineWidgetQueues[pos.line],
            deferred = new $.Deferred();
        if (!queue) {
            queue = new Async.PromiseQueue();
            this._inlineWidgetQueues[pos.line] = queue;
        }
        queue.add(function () {
            self._addInlineWidgetAboveInternal(pos, inlineWidget, scrollLineIntoView, deferred);
            return deferred.promise();
        });
        return deferred.promise();
    };
    
    /**
     * @private
     * Does the actual work of addInlineWidget().
     */
    Editor.prototype._addInlineWidgetAboveInternal = function (pos, inlineWidget, scrollLineIntoView, deferred) {
        var self = this;
        
        this.removeAllInlineWidgetsForLine(pos.line).done(function () {
            if (scrollLineIntoView === undefined) {
                scrollLineIntoView = true;
            }
    
            if (scrollLineIntoView) {
                self._codeMirror.scrollIntoView(pos);
            }
    
            inlineWidget.info = self._codeMirror.addLineWidget(pos.line, inlineWidget.htmlContent,
                                                               { coverGutter: true, noHScroll: true, above: true });
            CodeMirror.on(inlineWidget.info.line, "delete", function () {
                self._removeInlineWidgetInternal(inlineWidget);
            });
            self._inlineWidgets.push(inlineWidget);

            // Set up the widget to start closed, then animate open when its initial height is set.
            inlineWidget.$htmlContent.height(0);
            AnimationUtils.animateUsingClass(inlineWidget.htmlContent, "animating")
                .done(function () {
                    deferred.resolve();
                });

            // Callback to widget once parented to the editor. The widget should call back to
            // setInlineWidgetHeight() in order to set its initial height and animate open.
            inlineWidget.onAdded();
        });
    };

	/**
	 * @constructor
     * @param {String} functionIdentifier The permanent identifier for the function whose documentation is rendered
     * @param {Editor} hostEditor 
     * @param {{line: number, ch: number}} startBookmark start of the function in the source code
     * @param {{line: number, ch: number}} endBookmark end of the function in the source code
	 */
	function DocumentationInlineEditor (functionIdentifier, hostEditor, startPos, endPos) {
        this.functionIdentifier = functionIdentifier;
		this._startBookmark 	= hostEditor._codeMirror.setBookmark(startPos); 
		this._endBookmark 		= hostEditor._codeMirror.setBookmark(endPos);

		InlineWidget.call(this);

        TypeInformationStore.typeInformationForFunctionIdentifer(this.functionIdentifier).done(function (docs) {
            if (docs.length === 0) {
                return;
            } else {
                this.load(hostEditor);
                this.updateTypeInformation(docs[0]);

                hostEditor.addInlineWidgetAbove({ line: endPos.line + 1, ch: 0 }, this, true);
                hostEditor._hideLines(startPos.line, endPos.line + 1);

                $(TypeInformationStore).on("didUpdateTypeInformation", this._didUpdateTypeInformation.bind(this));
            }
        }.bind(this));
	}

	DocumentationInlineEditor.prototype = Object.create(InlineWidget.prototype);
	DocumentationInlineEditor.prototype.constructor = DocumentationInlineEditor;
	DocumentationInlineEditor.prototype.parentClass = InlineWidget.prototype;

	/**
     * Start of the range of code we're attached to; _startBookmark.find() may by null if sync is lost.
     * @type {!CodeMirror.Bookmark}
     */
    DocumentationInlineEditor.prototype._startBookmark = null;
    
    /**
     * End of the range of code we're attached to; _endBookmark.find() may by null if sync is lost or even
     * in some cases when it's not. Call getCurrentRange() for the definitive text range we're attached to.
     * @type {!CodeMirror.Bookmark}
     */
    DocumentationInlineEditor.prototype._endBookmark = null;

    /**
     * A div to hold the actual content of the widget
     * @type {jQueryObject}
     */
    DocumentationInlineEditor.prototype.$contentDiv = null;

    /**
     * The function identifier for which this widget displays information
     * @type {String}
     */
    DocumentationInlineEditor.prototype.functionIdentifier = null;

    /**
     * The currently displayed type information
     * @type {TypeInformation}
     */
    DocumentationInlineEditor.prototype.typeInformation = null;

    /**
     * The current editor displayed to show part of the documentation. This iVar must not be called editor, because the QuickView
     * extension accesses editors from all inline widgets and crashes.
     * @type {CodeMirror}
     */
    DocumentationInlineEditor.prototype.inlineEditor = null;

    /**
     * The docPartSpecifier currently displayed in the editor
     * @type {{partType: string, id: number}}
     */
    DocumentationInlineEditor.prototype.docPartSpecifier = null;

	/**
     * Returns the current text range of the color we're attached to, or null if
     * we've lost sync with what's in the code.
     * @return {?{start:{line:number, ch:number}, end:{line:number, ch:number}}}
     */
    DocumentationInlineEditor.prototype.getCurrentRange = function () {
        var start, end;
        
        start = this._startBookmark.find();
        if (!start) {
            return null;
        }
        
        end = this._endBookmark.find();
        if (!end) {
            end = { line: start.line };
        }
        
        // Even if we think we have a good end bookmark, we want to run the
        // regexp match to see if there's a valid match that extends past the bookmark.
		var i = start.line; 
		var matches, line;
		do {
			line = this.hostEditor.document.getLine(i);
			matches = line.match(/^\s*\*/);
			i++;			
		} while (matches);

		end = { line: i - 1 };
		line = this.hostEditor.document.getLine(end.line);
		matches = line.match(/^\s*\*\//);
		if (matches && (end.ch === undefined)) {
			end.ch = matches.index + matches[0].length;
			this._endBookmark.clear(); 
			this._endBookmark = this.hostEditor._codeMirror.setBookmark(end);
		}

        if (end.ch === undefined) {
            // We were unable to resync the end bookmark.
            return null;
        } else {
            return {start: start, end: end};
        }
    };

    /**
     * @override
     * @param {!Editor} hostEditor
     */
    DocumentationInlineEditor.prototype.load = function (hostEditor) {
        DocumentationInlineEditor.prototype.parentClass.load.apply(this, arguments);

        this.$contentDiv = $("<div />")
                                .addClass("ti-documentation-container")
                                .css("margin-left", $(hostEditor._codeMirror.display.gutters).width());
        this.$htmlContent.append(this.$contentDiv);
    };

    /**
     * @override
     * Perform sizing & focus once we've been added to Editor's DOM
     */
    DocumentationInlineEditor.prototype.onAdded = function () {
        DocumentationInlineEditor.prototype.parentClass.onAdded.apply(this, arguments);

        this.hostEditor.setInlineWidgetHeight(this, 150, true);
    };

    /**
     * Callback for new type information from the TypeStore 
     * @param  {jQueryEvent} evt
     * @param  {TypeInformation} newDoc
     */
    DocumentationInlineEditor.prototype._didUpdateTypeInformation = function(evt, newDoc) {
        if (newDoc.functionIdentifier === this.functionIdentifier) {
            this.updateTypeInformation(newDoc);
        }
    };

    /**
     * Update display with new type information that came in externally
     * @param  {TypeInformation} typeInformation
     */
    DocumentationInlineEditor.prototype.updateTypeInformation = function (typeInformation) {
        if (this.functionIdentifier !== typeInformation.functionIdentifier) {
            TIUtils.log("Inline widget for functionIdentifier "  + 
                this.functionIdentifier + 
                " updated with information for function identifier " + 
                typeInformation.functionIdentifier + 
                ". Aborting update!");
        }

        this.typeInformation = typeInformation;
        this._render();  
    };

    /**
     * This method rerenders the content of the widget
     */
     DocumentationInlineEditor.prototype._render = function() {
        var $line;

        this.$contentDiv.empty();

        var $descriptionContainer = $("<div />").addClass("ti-description"); 
        if (this.typeInformation.description) { 
            this.$contentDiv.append($("<h2 />").append("Description").addClass("ti-headline"));
            $descriptionContainer.append(TypeInformationHTMLRenderer.markdownStringToHTML(this.typeInformation.description)); 
        }
        this.$contentDiv.append($descriptionContainer);

        if (this.typeInformation.argumentTypes && (this.typeInformation.argumentTypes.length > 0)) {
           this.$contentDiv.append($("<h2 />").append("Parameters").addClass("ti-headline"));

           for (var i = 0; i < this.typeInformation.argumentTypes.length; i++) {
               $line = $(TypeInformationHTMLRenderer.typeToHTML(this.typeInformation.argumentTypes[i], true));
               $line.data("argumentId", i);
               $line.on("click", this._clickHandler.bind(this));
               this.$contentDiv.append($line); 
           }

           var $allTypeDivs = $(".ti-property-type");
           var maxWidth = _.max($allTypeDivs.map(function() {
               return $(this).width(); 
           }).get());
           //maxwidth should automatically include max-width set in css
           $allTypeDivs.width(maxWidth);
       }

       if (this.typeInformation.return) {
            $line = $(TypeInformationHTMLRenderer.typeToHTML(this.typeInformation.return, false));
            $line.on("click", this._clickHandler.bind(this));
            this.$contentDiv.append($line);
       }

       // this.hostEditor.setInlineWidgetHeight(this, this.$contentDiv.height(), true);
   };

    DocumentationInlineEditor.prototype._clickHandler = function(event) {
        var $target = $(event.currentTarget);

        if ($target.hasClass('ti-property')) {
            var argumentId = $target.data("argumentId"); 
            if (argumentId !== undefined) {
                this._displayEditorForPartOfTypeInfo({ partType: "parameters", id: argumentId });    
            } else {
                this._displayEditorForPartOfTypeInfo({ partType: "return" });
            }            
        }
    };

    DocumentationInlineEditor.prototype._closeEditor = function() {
        if (this.inlineEditor !== null) {
            var jsdocString = this.inlineEditor.getValue();
            this.typeInformation = TypeInformationJSDocRenderer.updateTypeInformationWithJSDoc(this.typeInformation, jsdocString);

            this.docPartSpecifier = null; 
            this.inlineEditor = null;
            this._render(); 
        }
    };

    /**
     * This function shows an editor for the specified part of the documentat. Other open editors are closed. 
     * @param  {{partType: string, id: number}} docPartSpecifier partType can be "parameters", "description"
     */
    DocumentationInlineEditor.prototype._displayEditorForPartOfTypeInfo = function(docPartSpecifier) {
        if (_.isEqual(this.docPartSpecifier, docPartSpecifier)) {
            //nothing to change
            return;
        }

        if (this.inlineEditor !== null) {
            this._closeEditor();
        }

        this.docPartSpecifier = docPartSpecifier;

        var codeMirrorOptions = {
            mode: "markdown",
            theme: "default",
            lineNumbers: false,
            height: "dynamic", 
            minHeight: 20
        };

        var $target;
        var jsDoc;
        var type;

        switch (docPartSpecifier.partType) {
            case "description": 
                jsDoc = (this.typeInformation.description === undefined) ? "" : this.typeInformation.description; 
                $target = this.$contentDiv.find(".ti-description");
                break; 
            case "parameters": 
                type = this.typeInformation.argumentTypes[docPartSpecifier.id]; 
                jsDoc = TypeInformationJSDocRenderer.typeSpecToJSDoc(type, true);

                $target = this.$contentDiv.find(".ti-property").filter(function (index) {
                    //this inside this filter function refers to the DOM element!
                    return $(this).data("argumentId") === docPartSpecifier.id;
                }); 
                break;
            case "return": 
                type = this.typeInformation.return; 
                jsDoc = TypeInformationJSDocRenderer.typeSpecToJSDoc(type, false);

                $target = this.$contentDiv.find(".ti-property").filter(function (index) {
                    return $(this).data("argumentId") === undefined;
                });
                break;
            default: 
                TIUtils.log("Unknown docPartSpecifier: " + docPartSpecifier.partType); 
                return;
        }

        codeMirrorOptions.value = jsDoc;

        this.inlineEditor = new CodeMirror(function (element) {
            $target.html(element);
        }, codeMirrorOptions);

        this.inlineEditor.on("keydown", this._onEditorKeyEvent.bind(this));
        this.inlineEditor.on("blur", this._onEditorBlur.bind(this));

        this.inlineEditor.focus();
        this.inlineEditor.setCursor(0, jsDoc.length - 1);

        // this.hostEditor.setInlineWidgetHeight(this, this.$contentDiv.height(), true);
    };

    /**
     * Key handler for the inline editors. Captures the Arrow Up/Down events to move between editors.
     * @param  {CodeMirror} theEditor
     * @param  {Event} event
     */
    DocumentationInlineEditor.prototype._onEditorKeyEvent = function (theEditor, event) {
        //sanity checks
        if ((event.type !== "keydown") || (theEditor !== this.inlineEditor)) {
            TIUtils.log("_onEditorKeyEvent callback called with invalid event or unknown editor");
            return;
        }

        var cursorPos = this.inlineEditor.getCursor();

        switch (event.keyCode) {
            case 38: //Arrow Up Key
                //Arrow Key Up
                if (cursorPos.line === 0) {
                    this._displayEditorForPartOfTypeInfo(this._nextDocPartSpecifierForDocPartSpecifier(this.docPartSpecifier, true));
                }
                break;
            case 40:
                if (cursorPos.line === this.inlineEditor.lineCount() - 1) {
                    this._displayEditorForPartOfTypeInfo(this._nextDocPartSpecifierForDocPartSpecifier(this.docPartSpecifier));
                }
                break;
        }
    };

    DocumentationInlineEditor.prototype._onEditorBlur = function() {
        this._closeEditor();
    };

    /**
     * This function returns the docPartSpecifier before or after the given one. If there is no next or previous docPartSpecifier, it
     * will return the unmodified input.
     * @param  {DocPartSpecifier}   docPartSpecifier
     * @param  {boolean}            backwards           If set to true, return the predecessor instead of the successor. Default is false
     * @return {DocPartSpecifier}
     */
    DocumentationInlineEditor.prototype._nextDocPartSpecifierForDocPartSpecifier = function(docPartSpecifier, backwards) {
        if (backwards === undefined) {
            backwards = false;
        }
        var result = _.clone(docPartSpecifier);

        var increment = backwards ? -1 : 1; 
        var partTypeIndex = DOC_PART_ORDER.indexOf(result.partType); 

        if (((result.id > 0) && backwards) || ((result.id < this._maxIdForDocPartType(result.partType)) && !backwards)) {
            result.id += increment; 
        } else {
            if (((partTypeIndex > 0) && backwards) || ((partTypeIndex < DOC_PART_ORDER.length) && !backwards)) {
                result.partType = DOC_PART_ORDER[partTypeIndex + increment];
                result.id = backwards ? this._maxIdForDocPartType(result.partType) : 0;
            }
        }

        return result;
    };

    /**
     * Returns the maximum value for the id part of a DocPartSpecifier, given a particular partType
     * @param  {String} partType
     * @return {Number}
     */
    DocumentationInlineEditor.prototype._maxIdForDocPartType = function(partType) {
        var result;

        switch (partType) {
            case "parameters": 
                result = this.typeInformation.argumentTypes.length - 1; 
                break;
            default: 
                result = 0;
        }

        return result;
    };

    module.exports = DocumentationInlineEditor;
});