'use client';

import { Fragment, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { workflowContent, workflowSteps } from './content';
import type { WorkflowKey, WorkflowNode } from './content';
import { Icon } from './Icon';

function WorkflowNodeCard({ node }: { node: WorkflowNode }) {
  return (
    <div className={`workflow-node${node.active ? ' active' : ''}`}>
      <span className="node-icon"><Icon name={node.icon} /></span>
      <strong>{node.title}</strong><small>{node.copy}</small>
    </div>
  );
}

export function Workflow() {
  const [current, setCurrent] = useState<WorkflowKey>('connect');
  const content = workflowContent[current];

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % workflowSteps.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + workflowSteps.length) % workflowSteps.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = workflowSteps.length - 1;
    const next = workflowSteps[nextIndex];
    if (!next) return;
    setCurrent(next.key);
    document.getElementById(`workflow-tab-${next.key}`)?.focus();
  }

  return (
    <section className="section workflow-section" id="workflow">
      <div className="container workflow-layout">
        <div className="reveal">
          <div className="section-kicker">From desk to pocket</div>
          <h2 className="section-title">连接一次，<br />随时继续。</h2>
          <p className="section-copy">桌面只建立主动出站连接，不开放公网入站端口。接入、授权与日常使用，各自清晰。</p>
          <div className="workflow-steps" role="tablist" aria-label="DSH Connect 工作步骤">
            {workflowSteps.map((step, index) => (
              <button
                className="workflow-step"
                type="button"
                role="tab"
                id={`workflow-tab-${step.key}`}
                key={step.key}
                aria-selected={current === step.key}
                aria-controls="workflow-panel"
                tabIndex={current === step.key ? 0 : -1}
                onClick={() => setCurrent(step.key)}
                onKeyDown={event => handleKeyDown(event, index)}
              >
                <span className="step-number">{step.number}</span>
                <span><span className="step-name">{step.name}</span><span className="step-copy">{step.copy}</span></span>
              </button>
            ))}
          </div>
        </div>
        <div className="workflow-visual reveal" role="tabpanel" id="workflow-panel" aria-labelledby={`workflow-tab-${current}`} aria-live="polite">
          <div className="workflow-panel" key={current}>
            <div className="workflow-demo-label"><span>{content.label}</span><span>{content.badge}</span></div>
            <div className="workflow-nodes">
              {content.nodes.map((node, index) => (
                <Fragment key={node.title}>
                  {index > 0 ? <span className="workflow-link"><i /></span> : null}
                  <WorkflowNodeCard node={node} />
                </Fragment>
              ))}
            </div>
            <div className="workflow-note"><strong>{content.notePrefix}</strong>{content.note}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
