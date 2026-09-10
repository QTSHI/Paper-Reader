import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import type { StudyGuide } from "./types";

const sourceAnchorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attachmentKey", "pageIndex", "blockId", "quote", "normalizedQuote", "blockHash"],
  properties: {
    attachmentKey: { type: "string", minLength: 1 },
    pageIndex: { type: "integer", minimum: 0 },
    blockId: { type: "string", minLength: 1 },
    quote: { type: "string", minLength: 1 },
    normalizedQuote: { type: "string", minLength: 1 },
    blockHash: { type: "string", minLength: 1 },
    bbox: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: { type: "number" },
    },
    startOffset: { type: "integer", minimum: 0 },
    endOffset: { type: "integer", minimum: 0 },
  },
} as const;

export const studyGuideSchema = {
  $id: "https://local.paper-reader/schema/study-guide-1.0.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "generatedAt",
    "generator",
    "paper",
    "preset",
    "overview",
    "sections",
    "methodFlow",
    "metrics",
    "criticalReading",
    "quiz",
  ],
  properties: {
    schemaVersion: { const: "1.0" },
    generatedAt: { type: "string", minLength: 1 },
    generator: {
      type: "object",
      additionalProperties: false,
      required: ["provider", "model", "promptVersion"],
      properties: {
        provider: { type: "string", minLength: 1 },
        model: { type: "string", minLength: 1 },
        promptVersion: { type: "string", minLength: 1 },
      },
    },
    paper: {
      type: "object",
      additionalProperties: false,
      required: [
        "libraryId",
        "itemKey",
        "attachmentKey",
        "attachmentVersion",
        "title",
        "creators",
        "year",
        "publication",
        "doi",
        "pageCount",
        "pdfHash",
      ],
      properties: {
        libraryId: { type: "integer" },
        itemKey: { type: "string", minLength: 1 },
        attachmentKey: { type: "string", minLength: 1 },
        attachmentId: { type: "integer" },
        attachmentVersion: { type: "integer", minimum: 0 },
        title: { type: "string", minLength: 1 },
        creators: { type: "array", items: { type: "string" } },
        year: { type: "string" },
        publication: { type: "string" },
        doi: { type: "string" },
        pageCount: { type: "integer", minimum: 1 },
        pdfHash: { type: "string", minLength: 1 },
      },
    },
    preset: {
      type: "object",
      additionalProperties: false,
      required: ["level", "background", "assistance"],
      properties: {
        level: { enum: ["B1", "B2"] },
        background: { enum: ["beginner", "foundation", "familiar"] },
        assistance: { enum: ["concise", "standard", "intensive"] },
      },
    },
    overview: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "subtitle", "units"],
        properties: {
          key: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          subtitle: { type: "string" },
          units: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "label",
                "purpose",
                "originalText",
                "translation",
                "source",
                "vocabulary",
                "logic",
                "validationStatus",
              ],
              properties: {
                id: { type: "string", minLength: 1 },
                label: { type: "string" },
                purpose: { type: "string" },
                originalText: { type: "string", minLength: 1 },
                translation: { type: "string" },
                source: sourceAnchorSchema,
                vocabulary: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["word", "partOfSpeech", "meaning", "usage"],
                    properties: {
                      word: { type: "string" },
                      partOfSpeech: { type: "string" },
                      meaning: { type: "string" },
                      usage: { type: "string" },
                    },
                  },
                },
                logic: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["label", "explanation"],
                    properties: {
                      label: { type: "string" },
                      explanation: { type: "string" },
                    },
                  },
                },
                validationStatus: { enum: ["valid", "needs_review"] },
                contentKind: { enum: ["prose", "formula", "caption", "reference", "metadata"] },
                visualId: { type: "string" },
              },
            },
          },
        },
      },
    },
    methodFlow: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "explanation"],
        properties: { label: { type: "string" }, explanation: { type: "string" } },
      },
    },
    metrics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "explanation", "source"],
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          explanation: { type: "string" },
          source: sourceAnchorSchema,
        },
      },
    },
    criticalReading: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "commentary", "sources"],
        properties: {
          title: { type: "string" },
          commentary: { type: "string" },
          sources: { type: "array", items: sourceAnchorSchema },
        },
      },
    },
    quiz: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question", "options", "answerIndex", "explanation", "source"],
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          options: { type: "array", minItems: 2, items: { type: "string" } },
          answerIndex: { type: "integer", minimum: 0 },
          explanation: { type: "string" },
          source: sourceAnchorSchema,
        },
      },
    },
    mode: { const: "full-reading" },
    generationStatus: { enum: ["partial", "complete"] },
    completedBlocks: { type: "integer", minimum: 0 },
    totalBlocks: { type: "integer", minimum: 0 },
    visuals: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "kind", "pageIndex", "caption", "imageDataUrl", "sourceBlockId"],
        properties: {
          id: { type: "string" }, kind: { enum: ["figure", "table", "formula"] },
          pageIndex: { type: "integer", minimum: 0 }, caption: { type: "string" },
          imageDataUrl: { type: "string" }, sourceBlockId: { type: "string" },
          bbox: { type: "array", minItems: 4, maxItems: 4, items: { type: "number" } },
        },
      },
    },
    logicGraph: {
      type: "object", additionalProperties: false,
      required: ["title", "nodes", "edges"],
      properties: {
        title: { type: "string" },
        nodes: { type: "array", items: {
          type: "object", additionalProperties: false,
          required: ["id", "kind", "label", "explanation", "sources"],
          properties: {
            id: { type: "string" },
            kind: { enum: ["background", "gap", "objective", "method", "experiment", "result", "conclusion", "limitation"] },
            label: { type: "string" }, explanation: { type: "string" },
            sources: { type: "array", items: sourceAnchorSchema },
          },
        } },
        edges: { type: "array", items: {
          type: "object", additionalProperties: false,
          required: ["from", "to", "label"],
          properties: { from: { type: "string" }, to: { type: "string" }, label: { type: "string" } },
        } },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: true });
const validateStudyGuide = ajv.compile(studyGuideSchema) as ValidateFunction<StudyGuide>;

export class SchemaValidationError extends Error {
  constructor(readonly errors: ErrorObject[]) {
    super(errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; "));
    this.name = "SchemaValidationError";
  }
}

export function parseStudyGuide(value: unknown): StudyGuide {
  if (!validateStudyGuide(value)) {
    throw new SchemaValidationError(validateStudyGuide.errors ?? []);
  }
  return value;
}
