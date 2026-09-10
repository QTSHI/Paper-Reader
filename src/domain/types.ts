export type ReaderLevel = "B1" | "B2";
export type ProfessionalBackground = "beginner" | "foundation" | "familiar";
export type AssistanceLevel = "concise" | "standard" | "intensive";
export type ValidationStatus = "valid" | "needs_review";
export type ReadingContentKind = "prose" | "formula" | "caption" | "reference" | "metadata";
export type PaperVisualKind = "figure" | "table" | "formula";

export interface ReaderPreset {
  level: ReaderLevel;
  background: ProfessionalBackground;
  assistance: AssistanceLevel;
}

export interface PaperRef {
  libraryId: number;
  itemKey: string;
  attachmentKey: string;
  attachmentId?: number;
  attachmentVersion: number;
  title: string;
  creators: string[];
  year: string;
  publication: string;
  doi: string;
  pageCount: number;
  pdfHash: string;
}

export interface SourceAnchor {
  attachmentKey: string;
  pageIndex: number;
  blockId: string;
  quote: string;
  normalizedQuote: string;
  blockHash: string;
  bbox?: [number, number, number, number];
  startOffset?: number;
  endOffset?: number;
}

export interface SourceBlock {
  blockId: string;
  pageIndex: number;
  order: number;
  text: string;
  normalizedText: string;
  hash: string;
  bbox?: [number, number, number, number];
}

export interface SourceSection {
  key: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  blocks: SourceBlock[];
}

export interface VocabularyEntry {
  word: string;
  partOfSpeech: string;
  meaning: string;
  usage: string;
}

export interface LogicNote {
  label: string;
  explanation: string;
}

export interface ReadingUnit {
  id: string;
  label: string;
  purpose: string;
  originalText: string;
  translation: string;
  source: SourceAnchor;
  vocabulary: VocabularyEntry[];
  logic: LogicNote[];
  validationStatus: ValidationStatus;
  contentKind?: ReadingContentKind;
  visualId?: string;
}

export interface PaperVisual {
  id: string;
  kind: PaperVisualKind;
  pageIndex: number;
  caption: string;
  imageDataUrl: string;
  sourceBlockId: string;
  bbox?: [number, number, number, number];
}

export interface LogicGraphNode {
  id: string;
  kind: "background" | "gap" | "objective" | "method" | "experiment" | "result" | "conclusion" | "limitation";
  label: string;
  explanation: string;
  sources: SourceAnchor[];
}

export interface LogicGraphEdge {
  from: string;
  to: string;
  label: string;
}

export interface LogicGraph {
  title: string;
  nodes: LogicGraphNode[];
  edges: LogicGraphEdge[];
}

export interface MethodNode {
  label: string;
  explanation: string;
}

export interface MetricItem {
  label: string;
  value: string;
  explanation: string;
  source: SourceAnchor;
}

export interface CriticalPrompt {
  title: string;
  commentary: string;
  sources: SourceAnchor[];
}

export interface QuizItem {
  id: string;
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  source: SourceAnchor;
}

export interface GuideSection {
  key: string;
  title: string;
  subtitle: string;
  units: ReadingUnit[];
}

export interface StudyGuide {
  schemaVersion: "1.0";
  generatedAt: string;
  generator: {
    provider: string;
    model: string;
    promptVersion: string;
  };
  paper: PaperRef;
  preset: ReaderPreset;
  overview: string;
  sections: GuideSection[];
  methodFlow: MethodNode[];
  metrics: MetricItem[];
  criticalReading: CriticalPrompt[];
  quiz: QuizItem[];
  mode?: "full-reading";
  generationStatus?: "partial" | "complete";
  completedBlocks?: number;
  totalBlocks?: number;
  visuals?: PaperVisual[];
  logicGraph?: LogicGraph;
}

export interface GenerationRequest<T> {
  model: string;
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  timeoutMs?: number;
  parse(value: unknown): T;
}

export interface GenerationResponse<T> {
  data: T;
  responseId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderHealth {
  ok: boolean;
  message: string;
}

export interface ModelProvider {
  readonly id: string;
  validateConfiguration(): Promise<ProviderHealth>;
  generate<T>(request: GenerationRequest<T>): Promise<GenerationResponse<T>>;
}
