import { assertTaskTransition, type TaskState } from '@astra/contracts';

export class TaskStateController {
  public current: TaskState = 'CREATED';

  transition(next: TaskState): void {
    assertTaskTransition(this.current, next);
    this.current = next;
  }
}
