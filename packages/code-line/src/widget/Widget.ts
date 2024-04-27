import {CodeLine} from "../CodeLine.ts";
import {CompositeDisposable, Disposable} from "../Disposable.ts";

export class Widget implements Disposable {
    codeLine!: CodeLine;
    protected disposables = new CompositeDisposable();

    dispose(): void {
        this.disposables.dispose();
    }

    init(codeLine: CodeLine) {
        this.codeLine = codeLine;
    }
}