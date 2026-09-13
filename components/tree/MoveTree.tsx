/**
 * Column view built from flex-wrap rather than a grid: index 13%, then two
 * move cells at 43.5%, over the WireGame model.
 * Variations and visible comments claim a full-width row, which is why they
 * break the white/black pairing and force a new one. [%clk]-only comments
 * strip to nothing and never interrupt (hasVisibleComment).
 */

import type { WireComment, WireGame, WireNode } from "../../electron/wire";

import { MoveNode, MOVE_NODE_MODE } from "./MoveNode";
import { MoveComment, hasVisibleComment, commentText } from "./MoveComment";
import { VariationLine } from "./VariationLine";
import { formatResult, nextResult } from "../../lib/chess/results";

interface MoveTreeProps {
  game: WireGame;
  currentId: string;
  /** When set, moves at or after this id are highlighted for deletion. */
  deleteFromId?: string | null;
  onNavigate: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, id: string) => void;
  /** Absent on read-only games: the row still shows, clicks do nothing. */
  onResultChange?: (result: string) => void;
  onRootCommentClick?: () => void;
}

function Idx({ n }: { n: number }): React.ReactElement {
  return (
    <span className="flex flex-[0_0_13%] select-none items-center justify-center border-r border-transp text-[13px] leading-7 text-txt-dimmer">
      {n}.
    </span>
  );
}

function EmptyCell(): React.ReactElement {
  return (
    <span className="mv pointer-events-none flex-[0_0_43.5%] px-2 font-normal leading-7 text-txt-dimmer">
      …
    </span>
  );
}

function Interrupt({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="max-w-full flex-[0_0_100%] border-y border-transp py-0.5 pr-2 text-sm">
      {children}
    </div>
  );
}

function RootComment({
  comments,
  onClick,
}: {
  comments: WireComment[];
  onClick?: () => void;
}): React.ReactElement {
  return (
    <div
      className={`block flex-[0_0_100%] break-words border-b border-b-transp border-l-2 border-l-primary py-1.5 pl-2 pr-2.5 text-[13px] text-primary-ink${onClick ? " cursor-pointer transition-colors hover:bg-default/50" : ""}`}
      data-testid="game-comment"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick();
            }
          : undefined
      }
    >
      {commentText(comments)}
    </div>
  );
}

function ResultRow({
  result,
  onClick,
}: {
  result: string;
  onClick?: () => void;
}): React.ReactElement {
  const display = formatResult(result === "*" ? null : result);
  return (
    <div
      className={`flex-[0_0_100%] select-none border-t border-transp pb-1 pt-1.5 text-center text-[15px] font-semibold ${
        onClick ? "cursor-pointer hover:text-txt-clear" : ""
      } ${result === "*" ? "text-txt-dimmer" : "text-txt-dim"}`}
      data-testid="game-result"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={onClick ? "Change result" : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick();
            }
          : undefined
      }
    >
      {display}
    </div>
  );
}

function variationsInterrupt(
  children: WireNode[],
  props: Pick<MoveTreeProps, "currentId" | "deleteFromId" | "onNavigate" | "onContextMenu">,
  key: string,
): React.ReactElement {
  return (
    <Interrupt key={key}>
      <div className="block">
        {children.slice(1).map((child) => (
          <VariationLine
            key={`v-${child.id}`}
            currentId={props.currentId}
            deleteFromId={props.deleteFromId}
            node={child}
            onContextMenu={props.onContextMenu}
            onNavigate={props.onNavigate}
          />
        ))}
      </div>
    </Interrupt>
  );
}

export function MoveTree({
  game,
  currentId,
  deleteFromId,
  onNavigate,
  onContextMenu,
  onResultChange,
  onRootCommentClick,
}: MoveTreeProps): React.ReactElement {
  const tagResult = game.tags.find(([name]) => name === "Result")?.[1];
  const resultRaw = game.resultText ?? tagResult ?? "*";
  const cycleResult = onResultChange
    ? () => onResultChange(nextResult(resultRaw))
    : undefined;

  const passProps = { currentId, deleteFromId, onNavigate, onContextMenu };

  if (game.children.length === 0) {
    return (
      <div className="flex flex-wrap">
        {hasVisibleComment(game.rootComments) && (
          <RootComment comments={game.rootComments} onClick={onRootCommentClick} />
        )}
        <div className="p-4 px-3 text-[13px] italic text-txt-dimmer">
          No moves yet. Play on the board to begin.
        </div>
        <ResultRow result={resultRaw} onClick={cycleResult} />
      </div>
    );
  }

  const items: React.ReactNode[] = [];
  let keyN = 0;
  const k = (): string => `k${keyN++}`;

  if (hasVisibleComment(game.rootComments)) {
    items.push(
      <RootComment key={k()} comments={game.rootComments} onClick={onRootCommentClick} />,
    );
  }

  let children: WireNode[] = game.children;

  while (children.length > 0) {
    const main = children[0];
    if (!main) break;
    const isWhite = main.turn === "white";
    const hasVariations = children.length > 1;

    // A black move arriving first means the game started with black, or an
    // interrupt broke the pair, so it needs its own index and a filler cell.
    if (!isWhite) {
      if (hasVisibleComment(main.startingComments)) {
        items.push(
          <Interrupt key={k()}>
            <MoveComment comments={main.startingComments} />
          </Interrupt>,
        );
      }
      items.push(<Idx key={k()} n={main.moveNumber} />);
      items.push(<EmptyCell key={k()} />);
      items.push(
        <MoveNode
          key={k()}
          currentId={currentId}
          deleteFromId={deleteFromId}
          mode={MOVE_NODE_MODE.MAINLINE}
          node={main}
          onContextMenu={onContextMenu}
          onNavigate={onNavigate}
        />,
      );
      if (hasVisibleComment(main.comments)) {
        items.push(
          <Interrupt key={k()}>
            <MoveComment comments={main.comments} />
          </Interrupt>,
        );
      }
      if (hasVariations) {
        items.push(variationsInterrupt(children, passProps, k()));
      }
      children = main.children;
      continue;
    }

    if (hasVisibleComment(main.startingComments)) {
      items.push(
        <Interrupt key={k()}>
          <MoveComment comments={main.startingComments} />
        </Interrupt>,
      );
    }
    items.push(<Idx key={k()} n={main.moveNumber} />);
    items.push(
      <MoveNode
        key={k()}
        currentId={currentId}
        deleteFromId={deleteFromId}
        mode={MOVE_NODE_MODE.MAINLINE}
        node={main}
        onContextMenu={onContextMenu}
        onNavigate={onNavigate}
      />,
    );

    let interrupted = false;

    if (hasVisibleComment(main.comments)) {
      items.push(<EmptyCell key={k()} />);
      items.push(
        <Interrupt key={k()}>
          <MoveComment comments={main.comments} />
        </Interrupt>,
      );
      interrupted = true;
    }

    if (hasVariations) {
      if (!interrupted) items.push(<EmptyCell key={k()} />);
      items.push(variationsInterrupt(children, passProps, k()));
      interrupted = true;
    }

    // No black reply, so pad the row or the wrap leaves a ragged edge.
    const blackMain = main.children[0];
    if (!blackMain) {
      if (!interrupted) items.push(<EmptyCell key={k()} />);
      break;
    }

    // A starting comment is a full-width interrupt, so black cannot share
    // the row white is already on.
    if (hasVisibleComment(blackMain.startingComments)) {
      if (!interrupted) items.push(<EmptyCell key={k()} />);
      items.push(
        <Interrupt key={k()}>
          <MoveComment comments={blackMain.startingComments} />
        </Interrupt>,
      );
      interrupted = true;
    }

    if (interrupted) {
      items.push(<Idx key={k()} n={blackMain.moveNumber} />);
      items.push(<EmptyCell key={k()} />);
    }
    items.push(
      <MoveNode
        key={k()}
        currentId={currentId}
        deleteFromId={deleteFromId}
        mode={MOVE_NODE_MODE.MAINLINE}
        node={blackMain}
        onContextMenu={onContextMenu}
        onNavigate={onNavigate}
      />,
    );

    if (hasVisibleComment(blackMain.comments)) {
      items.push(
        <Interrupt key={k()}>
          <MoveComment comments={blackMain.comments} />
        </Interrupt>,
      );
    }

    if (main.children.length > 1) {
      items.push(variationsInterrupt(main.children, passProps, k()));
    }

    children = blackMain.children;
  }

  items.push(<ResultRow key={k()} result={resultRaw} onClick={cycleResult} />);

  return <div className="flex flex-wrap">{items}</div>;
}
