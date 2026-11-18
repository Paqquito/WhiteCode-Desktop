/**
 * Panneau Plan.
 *
 * Deux choses distinctes, souvent confondues :
 *
 *  - le **plan**, texte que le modèle soumet avant d'agir quand il travaille
 *    en mode Plan (`ExitPlanMode`) ;
 *  - les **tâches**, liste vivante que le modèle tient pendant l'exécution
 *    (`TodoWrite`), et qui dit où il en est.
 *
 * Les deux sont reconstitués depuis le fil, comme les modifications de
 * session : le fil est déjà la source de vérité, et un état parallèle
 * finirait par diverger.
 *
 * L'intérêt du panneau tient à la position : ces informations existent déjà
 * dans la conversation, mais elles y défilent et se perdent. Épinglées à
 * droite, elles restent lisibles pendant que le modèle travaille — c'est
 * exactement le moment où l'on veut savoir ce qu'il reste à faire.
 */

import * as React from 'react'
import type { ThreadEntry } from '../../shared/protocol.js'
import { Markdown } from '../thread/Markdown.js'
import { Icon } from '../ui/Icon.js'
import { Panel, PanelEmpty } from '../ui/Panel.js'

type TodoStatus = 'pending' | 'in_progress' | 'completed'

type Todo = {
  content: string
  status: TodoStatus
  /** Formulation au présent, affichée pendant l'exécution. */
  activeForm?: string
}

/**
 * Dernier état des tâches et dernier plan soumis.
 *
 * `TodoWrite` réécrit la liste entière à chaque appel : seule la dernière
 * compte, les précédentes sont des états dépassés.
 */
function collect(entries: ThreadEntry[]): { todos: Todo[]; plan: string | null } {
  let todos: Todo[] = []
  let plan: string | null = null

  for (const entry of entries) {
    if (entry.kind !== 'tool') continue
    const input = entry.input as Record<string, unknown> | null
    if (!input || typeof input !== 'object') continue

    if (entry.name === 'update_todo_list' && Array.isArray(input.items)) {
      todos = input.items.filter(isTodo).map(item => ({ ...item, activeForm: (item as Todo & { progress_label?: string }).progress_label }))
    } else if (entry.name === 'submit_plan' && typeof input.plan_text === 'string') {
      plan = input.plan_text
    } else if (entry.name === 'TodoWrite' && Array.isArray(input.todos)) {
      todos = (input.todos as unknown[]).filter(isTodo)
    } else if (
      (entry.name === 'ExitPlanMode' || entry.name === 'EnterPlanMode') &&
      typeof input.plan === 'string'
    ) {
      plan = input.plan
    }
  }

  return { todos, plan }
}

function isTodo(value: unknown): value is Todo {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.content === 'string' &&
    (record.status === 'pending' ||
      record.status === 'in_progress' ||
      record.status === 'completed')
  )
}

export function PlanPanel({
  entries,
  onClose,
}: {
  entries: ThreadEntry[]
  onClose: () => void
}): React.ReactNode {
  const { todos, plan } = React.useMemo(() => collect(entries), [entries])

  const done = todos.filter(t => t.status === 'completed').length
  const empty = todos.length === 0 && !plan

  return (
    <Panel
      title="Plan"
      icon="list"
      onClose={onClose}
      padded={false}
      actions={
        todos.length > 0 ? (
          <span className="panel-badge">
            {done} / {todos.length}
          </span>
        ) : null
      }
    >
      {empty ? (
        <div className="panel-pad">
          <PanelEmpty icon="list">
            Le plan et la liste de tâches apparaîtront ici dès que le modèle en
            produit.
          </PanelEmpty>
        </div>
      ) : (
        <div className="plan">
          {todos.length > 0 && (
            <>
              <div className="plan-progress" aria-hidden="true">
                <span
                  className="plan-progress-fill"
                  style={{ width: `${(done / todos.length) * 100}%` }}
                />
              </div>
              <ol className="todos">
                {todos.map((todo, index) => (
                  <TodoRow key={index} todo={todo} />
                ))}
              </ol>
            </>
          )}

          {plan && (
            <section className="plan-text">
              <h3>Plan soumis</h3>
              <Markdown text={plan} />
            </section>
          )}
        </div>
      )}
    </Panel>
  )
}

function TodoRow({ todo }: { todo: Todo }): React.ReactNode {
  // La tâche en cours s'annonce au présent : c'est la formulation que le
  // modèle a écrite pour ce moment précis, elle décrit mieux l'instant que
  // l'intitulé à l'infinitif.
  const label =
    todo.status === 'in_progress' && todo.activeForm
      ? todo.activeForm
      : todo.content

  return (
    <li className={`todo ${todo.status}`}>
      <span className="todo-mark" aria-hidden="true">
        {todo.status === 'completed' && <Icon name="check" size={11} />}
        {todo.status === 'in_progress' && <span className="todo-spinner" />}
      </span>
      <span className="todo-label">{label}</span>
    </li>
  )
}
