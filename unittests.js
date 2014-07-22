/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache, describe, it, expect */

define(function (require, exports, module) {
    "use strict";

    var TypeInformationStore = require("./src/TypeInformationStore");

    describe("TypeSpec merging", function () {
        it("should remain the same if counts are the same and numbers", function () {
            expect(TypeInformationStore.forTests.mergeCounts(4, 4)).toEqual(4);
        });

        it("should return the super range if both are ranges", function() {
        	expect(TypeInformationStore.forTests.mergeCounts(
	        	{ min: 2, max: 4 },
	        	{ min: 3, max: 5 }
	       	)).toEqual({ min: 2, max: 5 });

	       	expect(TypeInformationStore.forTests.mergeCounts(
	        	{ min: 2, max: 4 },
	        	{ min: 1, max: 5 }
	       	)).toEqual({ min: 1, max: 5 });

	       	expect(TypeInformationStore.forTests.mergeCounts(
	        	{ min: 2, max: 4 },
	        	{ min: 3, max: 4 }
	       	)).toEqual({ min: 2, max: 4 });

	       	expect(TypeInformationStore.forTests.mergeCounts(
	        	{ min: 2, max: 5 },
	        	{ min: 3, max: 4 }
	       	)).toEqual({ min: 2, max: 5 });
        });

        it("should merge two different numbers to a range", function() {
        	expect(TypeInformationStore.forTests.mergeCounts(5, 9)).toEqual({ min: 5, max: 9 });
        	expect(TypeInformationStore.forTests.mergeCounts(5, 3)).toEqual({ min: 3, max: 5 });
        });

        it("should extend the range if only one is a range", function() {
        	expect(TypeInformationStore.forTests.mergeCounts(
	        	{ min: 2, max: 5 },
	        	6
	       	)).toEqual({ min: 2, max: 6 });

	       	expect(TypeInformationStore.forTests.mergeCounts(
	        	{ min: 2, max: 5 },
	        	1
	       	)).toEqual({ min: 1, max: 5 });

	       	expect(TypeInformationStore.forTests.mergeCounts(
	        	6,
	        	{ min: 2, max: 5 }
	       	)).toEqual({ min: 2, max: 6 });

	       	expect(TypeInformationStore.forTests.mergeCounts(
	       		1, 
	        	{ min: 2, max: 5 }
	       	)).toEqual({ min: 1, max: 5 });
        });

        it("should not alter the range if one is a number within the range", function() {
	       	expect(TypeInformationStore.forTests.mergeCounts(
	        	{ min: 2, max: 5 },
	        	3
	       	)).toEqual({ min: 2, max: 5 });

			expect(TypeInformationStore.forTests.mergeCounts(
				3, 
	        	{ min: 2, max: 5 }
	       	)).toEqual({ min: 2, max: 5 });
        });

        it("should change type to multiple if types are not equal but both primitive", function() {
        	expect(TypeInformationStore.mergeTypeSpecs(
	        	{
	        		type: "string"
	        	},
	        	{
	        		type: "number"
	        	}))
        	.toEqual(
	        	{
	        		type: "multiple",
	        		spec: [
		        		{ type: "string" },
		        		{ type: "number" }
	        		]
	        	});
        });

        it("should keep the type if both have the same", function() {
        	expect(TypeInformationStore.mergeTypeSpecs(
	        	{
	        		type: "string"
	        	},
	        	{
	        		type: "string"
	        	}))
        	.toEqual(
	        	{
	        		type: "string"
	        	});
        });


        it("should not alter two equal array types", function() {
        	expect(TypeInformationStore.mergeTypeSpecs(
	        	{
	        		type: "array",
	        		spec: [{ type: "number", count: 5 }]
	        	},
	        	{
	        		type: "array",
	        		spec: [{ type: "number", count: 5 }]
	        	}))
        	.toEqual(
	        	{
	        		type: "array",
	        		spec: [{ type: "number", count: 5 }]
	        	});
        });

        it("should only alter count for two otherwise equal array types", function() {
        	expect(TypeInformationStore.mergeTypeSpecs(
	        	{
	        		type: "array",
	        		spec: [{ type: "number", count: 5 }]
	        	},
	        	{
	        		type: "array",
	        		spec: [{ type: "number", count: 1 }]
	        	}))
        	.toEqual(
	        	{
	        		type: "array",
	        		spec: [{ type: "number", count: { min: 1, max: 5 } }]
	        	});
        });

        it("should merge arrays with a singule type each of different type to a singular any type array", function() {
        	expect(TypeInformationStore.mergeTypeSpecs(
	        	{
	        		type: "array",
	        		spec: [{ type: "number", count: 5 }]
	        	},
	        	{
	        		type: "array",
	        		spec: [{ type: "string", count: 1 }]
	        	}))
        	.toEqual(
	        	{
	        		type: "array",
	        		spec: [{ type: "multiple", spec: [{ type: "number" }, { type: "string" }], count: { min: 1, max: 5 } }]
	        	});
        });

        it("should merge arrays with multiple types of different counts to same types with adjusted counts", function() {
        	expect(TypeInformationStore.mergeTypeSpecs(
	        	{
	        		type: "array",
	        		spec: [
	        			{ type: "number", count: 5 },
	        			{ type: "string", count: 5 }
	        		 ]
	        	},
	        	{
	        		type: "array",
	        		spec: [
	        			{ type: "number", count: 1 },
	        			{ type: "string", count: 6 }
	        		 ]
	        	}))
        	.toEqual(
	        	{
	        		type: "array",
	        		spec: [
	        			{ type: "number", count: { min: 1, max: 5 } },
	        			{ type: "string", count: { min: 5, max: 6 } }
	        		 ]
	        	});
        });

        it("should merge arrays with multiple types that don't match to any type with adjusted counts and less typespec entries", function() {
        	expect(TypeInformationStore.mergeTypeSpecs(
	        	{
	        		type: "array",
	        		spec: [
	        			{ type: "number", count: 5 },
	        			{ type: "string", count: 5 }
	        		 ]
	        	},
	        	{
	        		type: "array",
	        		spec: [
	        			{ type: "string", count: 1 },
	        			{ type: "number", count: 6 }
	        		 ]
	        	}))
        	.toEqual(
	        	{
	        		type: "array",
	        		spec: [{ type: "multiple", spec: [{ type: "number" }, { type: "string" }], count: { min: 7, max: 10 } }]
	        	});
        });

        it("should not change anything for identical objects", function() {
        	expect(TypeInformationStore.mergeTypeSpecs(
	        	{
	        		type: "object",
	        		spec: {
	        			name: { type: "string" },
	        			age: { type: "number" }
	        		}
	        	},
	        	{
	        		type: "object",
	        		spec: {
	        			name: { type: "string" },
	        			age: { type: "number" }
	        		}
	        	}))
        	.toEqual(
	        	{
	        		type: "object",
	        		spec: {
	        			name: { type: "string" },
	        			age: { type: "number" }
	        		}
	        	});
        });

        it("should mark items optional that only occur in one object", function() {
        	expect(TypeInformationStore.mergeTypeSpecs(
	        	{
	        		type: "object",
	        		spec: {
	        			name: { type: "string" },
	        			age: { type: "number" }
	        		}
	        	},
	        	{
	        		type: "object",
	        		spec: {
	        			name: { type: "string" }
	        		}
	        	}))
        	.toEqual(
	        	{
	        		type: "object",
	        		spec: {
	        			name: { type: "string" },
	        			age: { type: "number", optional: true }
	        		}
	        	});
        });

		it("should correctly handle nesting: arrays inside objects", function() {
        	expect(TypeInformationStore.mergeTypeSpecs(
	        	{
	        		type: "object",
	        		spec: {
	        			name: { type: "string" },
	        			age: { 
	        				type: "array",
			        		spec: [
			        			{ type: "number", count: 5 },
			        			{ type: "string", count: 5 }
			        		]
			        	}
	        		}
	        	},
	        	{
	        		type: "object",
	        		spec: {
	        			name: { type: "string" },
	        			age: {
			        		type: "array",
			        		spec: [
			        			{ type: "string", count: 1 },
			        			{ type: "number", count: 6 }
			        		 ]
			        	}
	        		}
	        	}))
        	.toEqual(
	        	{
	        		type: "object",
	        		spec: {
	        			name: { type: "string" },
	        			age: {
			        		type: "array",
			        		spec: [{ type: "multiple", spec: [{ type: "number" }, { type: "string" }], count: { min: 7, max: 10 } }]
			        	}
	        		}
	        	});
        });

		it("should correctly handle nesting: objects inside arrays", function() {
        	expect(TypeInformationStore.mergeTypeSpecs(
	        	{
	        		type: "array",
	        		spec: [{
	        			type: "object",
	        			count: 5,
	        			spec: {
		        			name: { type: "string" },
		        			age: { type: "number" }
		        		}
	        		}]
	        	},
	        	{
	        		type: "array",
	        		spec: [{
	        			type: "object",
	        			count: 2,
	        			spec: {
		        			name: { type: "string" },
		        			age: { type: "number" }
		        		}
	        		}]
	        	}))
        	.toEqual(
	        	{
	        		type: "array",
	        		spec: [{
	        			type: "object",
	        			count: { min: 2, max: 5 },
	        			spec: {
		        			name: { type: "string" },
		        			age: { type: "number" }
		        		}
	        		}]
	        	});
        });
    });
});