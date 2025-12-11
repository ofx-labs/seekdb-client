export interface PromptRequest {
  message: string;
  element: {
    tag: string;
    selector: string;
    text: string;
    className: string;
    styles: Record<string, string>;
    innerHTML: string;
  };
  context: {
    url: string;
    file: string;
    timestamp: number;
  };
}
