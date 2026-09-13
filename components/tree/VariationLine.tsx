/**
 * One variation as an inline run of text, recursing into sub-variations.
 * Left-border tree guides via before:/after: pseudo-elements.
 *
 * Continuation moves inside the line receive `deleteFromId`, so delete-hover
 * marks the whole doomed line, not just its first move.
 */

import type { WireNode } from "../../electron/wire";

import { MoveNode, MOVE_NODE_MODE } from "./MoveNode";
import { MoveComment, hasVisibleComment } from "./MoveComment";

interface VariationLineProps {
  node: WireNode;
  currentId: string;
  deleteFromId?: string | null;
  onNavigate: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, id: string) => void;
  depth?: number;
}

export function VariationLine({
  node,
  currentId,
  deleteFromId,
  onNavigate,
  onContextMenu,
  depth = 1,
}: VariationLineProps): React.ReactElement {
  const elements: React.ReactNode[] = [];

  if (hasVisibleComment(node.startingComments)) {
    elements.push(
      <MoveComment key={`sc-${node.id}`} comments={node.startingComments} variant="variation" />,
      " ",
    );
  }

  elements.push(
    <MoveNode
      key={`m-${node.id}`}
      showIndex
      currentId={currentId}
      deleteFromId={deleteFromId}
      depth={depth}
      mode={MOVE_NODE_MODE.VARIATION}
      node={node}
      onContextMenu={onContextMenu}
      onNavigate={onNavigate}
    />,
    " ",
  );

  if (hasVisibleComment(node.comments)) {
    elements.push(
      <MoveComment key={`c-${node.id}`} comments={node.comments} variant="variation" />,
      " ",
    );
  }

  let current: WireNode = node;
  let needsIndex = false;

  while (current.children.length > 0) {
    const mainChild = current.children[0];
    if (!mainChild) break;

    if (hasVisibleComment(mainChild.startingComments)) {
      elements.push(
        <MoveComment
          key={`sc-${mainChild.id}`}
          comments={mainChild.startingComments}
          variant="variation"
        />,
        " ",
      );
      needsIndex = true;
    }

    const showIdx = mainChild.turn === "white" || needsIndex;

    elements.push(
      <MoveNode
        key={`m-${mainChild.id}`}
        currentId={currentId}
        deleteFromId={deleteFromId}
        depth={depth}
        mode={MOVE_NODE_MODE.VARIATION}
        node={mainChild}
        showIndex={showIdx}
        onContextMenu={onContextMenu}
        onNavigate={onNavigate}
      />,
      " ",
    );
    needsIndex = false;

    if (hasVisibleComment(mainChild.comments)) {
      elements.push(
        <MoveComment key={`c-${mainChild.id}`} comments={mainChild.comments} variant="variation" />,
        " ",
      );
      needsIndex = true;
    }

    if (current.children.length > 1) {
      elements.push(
        <div key={`lines-${mainChild.id}`} className="block">
          {current.children.slice(1).map((child) => (
            <VariationLine
              key={`v-${child.id}`}
              currentId={currentId}
              deleteFromId={deleteFromId}
              depth={depth + 1}
              node={child}
              onContextMenu={onContextMenu}
              onNavigate={onNavigate}
            />
          ))}
        </div>,
      );
      needsIndex = true;
    }

    current = mainChild;
  }

  return (
    <div className="relative block pl-1.5 before:absolute before:left-0 before:top-0 before:h-full before:w-2 before:border-l-2 before:border-transp before:content-[''] after:absolute after:left-0 after:top-[0.8em] after:h-0.5 after:w-1.5 after:border-t-2 after:border-transp after:content-[''] last:before:h-[calc(0.8em+2px)]">
      {elements}
    </div>
  );
}
