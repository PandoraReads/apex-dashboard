declare module "frappe-gantt" {
  export default class Gantt {
    $container: HTMLElement;
    set_scroll_position(): void;
    dates: Date[];
    render(): void;
    bars: {
      compute_x(this: {
        gantt: Gantt;
        task: { _start: Date };
        x: number;
      }): void;
    }[];
    constructor(
      element: HTMLElement,
      tasks: unknown[],
      options: Record<string, unknown>,
    );
  }
}
