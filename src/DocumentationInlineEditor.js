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
    var JSDocTypeProvider              = require("./JSDocTypeProvider");
    var TheseusTypeProvider            = require("./TheseusTypeProvider");
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

        this._onEditorBlur              = this._onEditorBlur.bind(this);
        this._onEditorKeyEvent          = this._onEditorKeyEvent.bind(this);
        this._didUpdateTypeInformation  = this._didUpdateTypeInformation.bind(this);
        this._clickHandler              = this._clickHandler.bind(this);
        this._recalculateHeight         = this._recalculateHeight.bind(this);

		InlineWidget.call(this);

        this.$htmlContent.empty();
        this.$htmlContent.off();

        TypeInformationStore.typeInformationForFunctionIdentifer(this.functionIdentifier).done(function (docs) {
            if (docs.length === 0) {
                return;
            } else {
                this.load(hostEditor);
                this.updateTypeInformation(docs[0]);

                hostEditor.addInlineWidgetAbove({ line: endPos.line + 1, ch: 0 }, this, true);
                hostEditor._hideLines(startPos.line, endPos.line + 1);

                $(TypeInformationStore).on("didUpdateTypeInformation", this._didUpdateTypeInformation);
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
    DocumentationInlineEditor.prototype.docPartSpecifier = undefined;

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
			matches = line.match(/^\s*\/?\*/);
			i++;			
		} while (matches);

		end = { line: i - 2 };
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
        this.$contentDiv.on("click", this._clickHandler);
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
    DocumentationInlineEditor.prototype._didUpdateTypeInformation = function(evt, newDoc, pendingChanges) {
        if (newDoc.functionIdentifier === this.functionIdentifier) {
            this.updateTypeInformation(newDoc, pendingChanges);
        }
    };

    /**
     * Update display with new type information that came in externally
     * @param  {TypeInformation} typeInformation
     */
    DocumentationInlineEditor.prototype.updateTypeInformation = function (typeInformation, pendingChanges) {
        if (this.functionIdentifier !== typeInformation.functionIdentifier) {
            TIUtils.log("Inline widget for functionIdentifier "  + 
                this.functionIdentifier + 
                " updated with information for function identifier " + 
                typeInformation.functionIdentifier + 
                ". Aborting update!");
        }

        var needsRerender = false; 
        if (! _.isEqual(this.typeInformation, typeInformation)) { 
            this.typeInformation = typeInformation;
            needsRerender = true; 
        }

        if (pendingChanges !== undefined) {
            this.pendingChanges = pendingChanges; 
            needsRerender = true; 
        }

        if (needsRerender) {
            this._render();
        }
    };

    /**
     * Move the cursor into the editor
     * @param  {boolean} fromBelow If set to true, the last line will be edited, otherwise the first
     */
    DocumentationInlineEditor.prototype.focus = function(fromBelow) {
        if (fromBelow === undefined) {
            fromBelow = false;
        }

        if (fromBelow) {
            this.docPartSpecifier = { partType: _.last(this._availableDocPartTypes()) };
        } else {
            this.docPartSpecifier = { partType: _.first(this._availableDocPartTypes()) };
        }

        this._render();
    };

    /**
     * This method rerenders the content of the widget
     */
     DocumentationInlineEditor.prototype._render = function() {
        var $line;
        var pendingChanges; 

        var insertPendingChange = function (pendingChanges, $line, argumentTypeId) {
            if (argumentTypeId === undefined) {
                argumentTypeId = -1;
            }

            pendingChanges = _.cloneDeep(pendingChanges);
            if ((pendingChanges !== undefined) && (! _.isEmpty(pendingChanges))) {
                var $pendingChangesTable = $(TypeInformationHTMLRenderer.pendingChangesToHTML(pendingChanges, true));
                $pendingChangesTable.hide();

                var $mergeButton = $pendingChangesTable.find("tr:eq(1) a");
                $mergeButton.on("click", this._markCorrectClickHandler.bind(this, argumentTypeId, "merge")); 

                var $individualRows = $pendingChangesTable.find("tr:gt(2)");
                $individualRows.each(function (index, element) {
                    var $row = $(element); 
                    var theseusInvocationId = $row.data("theseusinvocationid");
                    $mergeButton = $row.find("a:first"); 
                    $mergeButton.on("click", this._markCorrectClickHandler.bind(this, argumentTypeId, theseusInvocationId));

                    var $jumpToCallButton = $row.find("a:last");
                    $jumpToCallButton.on("click", this._showCallLocationClickHandler.bind(this, theseusInvocationId));
                }.bind(this));

                var $openChangesButton = $("<a />").addClass('ti-button').text("Type mismatch"); 
                $openChangesButton.addClass('ti-alert');
                $openChangesButton.on("click", function (event) {
                    $pendingChangesTable.toggle();
                    setTimeout(function () {
                        var $cells = $pendingChangesTable.find(".ti-property-type");
                        var maxWidth = _.max($cells.map(function() {
                            return $(this).outerWidth(); 
                        }).get());
                        // $cells.outerWidth(maxWidth);

                        this._recalculateHeight();
                    }.bind(this), 1);

                    event.stopPropagation();
                }.bind(this));

                $line.find("tr").append($openChangesButton);
                $line.append($pendingChangesTable);
            }
        }.bind(this);

        this._closeEditor();
        this.$contentDiv.empty();

        var $descriptionContainer = $("<div />").addClass("ti-description"); 
        if (this.typeInformation.description) { 
            this.$contentDiv.append($("<h2 />").append("Description").addClass("ti-headline"));
            $descriptionContainer.append(TypeInformationHTMLRenderer.markdownStringToHTML(this.typeInformation.description));
            $descriptionContainer.on("click", this._clickHandler);
        }
        this.$contentDiv.append($descriptionContainer);

        if (this.typeInformation.argumentTypes && (this.typeInformation.argumentTypes.length > 0)) {
            this.$contentDiv.append($("<h2 />").append("Parameters").addClass("ti-headline"));

            var omitFunction = function (i, pendingChange) {
                return (pendingChange.argumentTypes && pendingChange.argumentTypes[i]) === undefined; 
            };

            var mapValuesFunction = function (i, pendingChange) {
                return pendingChange.argumentTypes[i]; 
            };

            for (var i = 0; i < this.typeInformation.argumentTypes.length; i++) {
                $line = $(TypeInformationHTMLRenderer.typeToHTML(this.typeInformation.argumentTypes[i], true));                 
                if (this.pendingChanges !== undefined) {
                    pendingChanges = _(this.pendingChanges).omit(omitFunction.bind(this, i)).mapValues(mapValuesFunction.bind(this, i)).value();
                    insertPendingChange(pendingChanges, $line, i);
                }
                $line.data("argumentId", i);
                $line.on("click", this._clickHandler);
                this.$contentDiv.append($line); 
            }
        }

        if (this.typeInformation.returnType) {
            $line = $(TypeInformationHTMLRenderer.typeToHTML(this.typeInformation.returnType, false));
            $line.addClass('ti-return');
            if (this.pendingChanges !== undefined) {
                pendingChanges = _(this.pendingChanges).omit(function (pendingChange) {
                    return (pendingChange.returnType === undefined); 
                }).mapValues("returnType").value();
                insertPendingChange(pendingChanges, $line, undefined);
            }

            $line.on("click", this._clickHandler);
            this.$contentDiv.append($line);
        }

        this._displayEditorForPartOfTypeInfo();

        var cellsToAlign =  [ this.$contentDiv.find(".ti-property-type").not(".table .ti-property-type"), 
                              this.$contentDiv.find(".ti-property-name") ];
        setTimeout(function () {
            _.forEach(cellsToAlign, function ($cells) {
                var maxWidth = _.max($cells.map(function() {
                    return $(this).outerWidth(); 
                }).get());
                //maxwidth should automatically include max-width set in css
                $cells.outerWidth(maxWidth);
            });

            this._recalculateHeight(); 
        }.bind(this), 1);
   };

    /**
     * Updates the height of the inline widget if needed
     */
    DocumentationInlineEditor.prototype._recalculateHeight = function() {
        this.hostEditor.setInlineWidgetHeight(this, Math.max(this.$contentDiv.height() + 10, 38), true);
    };

    /**
     * The click handler for all the "Add to JSDoc" links. Basically this is called when someone manually adds a pending change
     * to the type information. It will update the type information in the store and try to merge all other pending changes. 
     * Pending changes are deleted and will only come back if merging fails again after adding one of the pending changes.
     * @param  {number} argumentTypeId    Index in the argument array or -1 for returnType. Preset via bind, not from event
     * @param  {string} pendingChangesKey Key for the pending changes hash. Can be a theseus invocation ID or "merge". Preset via bind
     * @param  {object} event             The event
     */
    DocumentationInlineEditor.prototype._markCorrectClickHandler = function(argumentTypeId, pendingChangesKey, event) {
        if (argumentTypeId > -1) {
            //we have an argument change
            this.typeInformation.argumentTypes[argumentTypeId] = this.pendingChanges[pendingChangesKey].argumentTypes[argumentTypeId];
        } else {
            this.typeInformation.returnType = this.pendingChanges[pendingChangesKey].returnType; 
        }

        TypeInformationStore.userUpdatedTypeInformation(this, [ this.typeInformation ], false);

        //we need to check if the other pending changes now actually conform to the type info. 
        //let's just submit the pending changes as new type information, if they merge flawlessly, we're good, 
        //otherwise we will just get them back later. 
        var typeInformationFromPendingChanges = _.map(_.omit(this.pendingChanges, "merge"), function (pendingChange) {
            var result = _.cloneDeep(this.typeInformation);

            if (pendingChange.argumentTypes !== undefined) {
                for (var i = 0; i < pendingChange.argumentTypes.length; i++) {
                    if (pendingChange.argumentTypes[i] !== undefined) {
                        result.argumentTypes[i] = pendingChange.argumentTypes[i]; 
                    }
                }
            }

            if (pendingChange.returnType !== undefined) {
                result.returnType = pendingChange.returnType;
            }

            return result;
        }.bind(this));

        TypeInformationStore.userUpdatedTypeInformation(this, typeInformationFromPendingChanges, true, true);

        event.stopPropagation();

        this.pendingChanges = undefined;        
        this._render();
   };

   /**
    * Click handler for the "jump to call" links. Will scroll the callsite into view and briefly highlight the line.
    * @param  {string} theseusInvocationId Theseus invocation id for the call. Preset via bind
    * @param  {object} event               
    */
   DocumentationInlineEditor.prototype._showCallLocationClickHandler = function(theseusInvocationId, event) {
        TheseusTypeProvider.callingInvocationForFunctionInvocation(theseusInvocationId).done(function (caller) {
            this.hostEditor.setCursorPos(caller.range.end.line - 1, caller.range.end.ch, true);
            this.hostEditor.focus();

            this.hostEditor._codeMirror.addLineClass(caller.range.end.line - 1, "background", "ti-highlight");
            setTimeout(function () {
                this.hostEditor._codeMirror.removeLineClass(caller.range.end.line - 1, "background", "ti-highlight");
            }.bind(this), 2000);
        }.bind(this)).fail(function (err) {
            console.log(err);
        }.bind(this)); 

       event.stopPropagation(); 
   };

    /**
     * Click handler for clicks on the widget. Will show a editor for the doc part that was targeted if any. 
     * @param  {object} event 
     */
    DocumentationInlineEditor.prototype._clickHandler = function(event) {
        var $target = $(event.currentTarget);

        if ($target.hasClass('ti-property')) {
            var argumentId = $target.data("argumentId"); 
            if (argumentId !== undefined) {
                this.docPartSpecifier = { partType: "parameters", id: argumentId }; 
            } else {
                this.docPartSpecifier = { partType: "return" }; 
            }            
        } else {
            this.docPartSpecifier = { partType: "description" }; 
        }

        this._displayEditorForPartOfTypeInfo();
        event.stopPropagation();
    };

    /**
     * Close the inline editor and send the updated type information to the store. 
     */
    DocumentationInlineEditor.prototype._closeEditor = function() {
        if (this.inlineEditor !== null) {
            //tear down notifications to make sure don't get a blur event that would cause us to forget the docPartSpecifier
            this.inlineEditor.off("blur", this._onEditorBlur);

            var jsdocString = this.inlineEditor.getValue();
            var typeInformationUpdate = TypeInformationJSDocRenderer.updateTypeInformationWithJSDoc(_.cloneDeep(this.typeInformation), jsdocString);
            //Only update the info we need. The other information might be wrong, e.g. description will always be empty when editing 
            //something else but description
            var $wrapper = $(this.inlineEditor.getWrapperElement()).parent(); 
            if ($wrapper.hasClass('ti-description')) {
                this.typeInformation.description = typeInformationUpdate.description;
            }
            this.typeInformation.argumentTypes = typeInformationUpdate.argumentTypes;
            this.typeInformation.returnType = typeInformationUpdate.returnType; 

            TypeInformationStore.userUpdatedTypeInformation(this, [ this.typeInformation ], false);

            this.inlineEditor = null;
        }
    };

    /**
     * This function shows an editor for the specified part of the document part. Other open editors are closed. 
     * @param  {{partType: string, id: number}} docPartSpecifier partType can be "parameters", "description"
     */
    DocumentationInlineEditor.prototype._displayEditorForPartOfTypeInfo = function() {
        if (this.docPartSpecifier === undefined) {
            return;
        }

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
        var needsTopMargin = false; 

        switch (this.docPartSpecifier.partType) {
            case "description": 
                jsDoc = (this.typeInformation.description === undefined) ? "" : this.typeInformation.description; 
                $target = this.$contentDiv.find(".ti-description");
                needsTopMargin = $target.is(":empty");
                break; 
            case "parameters": 
                type = this.typeInformation.argumentTypes[this.docPartSpecifier.id]; 
                jsDoc = TypeInformationJSDocRenderer.typeSpecToJSDoc(type, true);

                var self = this; 
                $target = this.$contentDiv.find(".ti-property").filter(function (index) {
                    //this inside this filter function refers to the DOM element!
                    return $(this).data("argumentId") === self.docPartSpecifier.id;
                }); 
                break;
            case "return": 
                type = this.typeInformation.returnType; 
                jsDoc = TypeInformationJSDocRenderer.typeSpecToJSDoc(type, false);

                $target = this.$contentDiv.find(".ti-property").filter(function (index) {
                    return $(this).data("argumentId") === undefined;
                });
                break;
            default: 
                TIUtils.log("Unknown docPartSpecifier: " + this.docPartSpecifier.partType); 
                return;
        }

        codeMirrorOptions.value = jsDoc;

        this.inlineEditor = new CodeMirror(function (element) {
            if (needsTopMargin) {
                $(element).css("margin-top", "3px");
            }
            $target.html(element);
        }, codeMirrorOptions);

        this.inlineEditor.on("keydown", this._onEditorKeyEvent);
        this.inlineEditor.on("blur", this._onEditorBlur);

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
        var range, line;

        switch (event.keyCode) {
            case 38: //Arrow Up Key
                //Arrow Key Up
                if (cursorPos.line === 0) {
                    this.docPartSpecifier = this._nextDocPartSpecifierForDocPartSpecifier(this.docPartSpecifier, true);
                    if (this.docPartSpecifier === undefined) {
                        //refocus host editor
                        range = this.getCurrentRange(); 
                        line = this.hostEditor.document.getLine(range.start.line - 1); 
                        this.hostEditor.setCursorPos({ line: range.start.line - 1, ch: line.length }); 
                        this.hostEditor.focus();
                    }
                    this._render();
                }
                break;
            case 40:
                if (cursorPos.line === this.inlineEditor.lineCount() - 1) {
                    this.docPartSpecifier = this._nextDocPartSpecifierForDocPartSpecifier(this.docPartSpecifier);
                    if (this.docPartSpecifier === undefined) {
                        range = this.getCurrentRange(); 
                        line = this.hostEditor.document.getLine(range.end.line + 1); 
                        this.hostEditor.setCursorPos({ line: range.end.line + 1, ch: line.length }); 
                        this.hostEditor.focus(); 
                    }
                    this._render();
                }
                break;
        }
    };

    /**
     * Handler for when an editor looses focus
     */
    DocumentationInlineEditor.prototype._onEditorBlur = function() {
        this.docPartSpecifier = undefined;
        this._render();
    };

    /**
     * This function returns the docPartSpecifier before or after the given one. If there is no next or previous docPartSpecifier, it
     * will return undefined.
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
        var localDocPartOrder = this._availableDocPartTypes();

        var partTypeIndex = localDocPartOrder.indexOf(result.partType); 

        if (((result.id > 0) && backwards) || ((result.id < this._maxIdForDocPartType(result.partType)) && !backwards)) {
            result.id += increment; 
        } else if (((partTypeIndex > 0) && backwards) || ((partTypeIndex < localDocPartOrder.length - 1) && !backwards)) {
            result.partType = localDocPartOrder[partTypeIndex + increment];
            result.id = backwards ? this._maxIdForDocPartType(result.partType) : 0;
        } else {
            return undefined;
        }

        return result;
    };

    /**
     * Returns the docPartTypes that are available for the current typeInformation
     * @return {[string]}
     */
    DocumentationInlineEditor.prototype._availableDocPartTypes = function() {
        var localDocPartOrder = _.clone(DOC_PART_ORDER);
        if (this.typeInformation.argumentTypes === undefined) {
            localDocPartOrder.splice(localDocPartOrder.indexOf("parameters"), 1);
        }
        if (this.typeInformation.returnType === undefined) {
            localDocPartOrder.splice(localDocPartOrder.indexOf("return"), 1);
        }

        return localDocPartOrder;
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