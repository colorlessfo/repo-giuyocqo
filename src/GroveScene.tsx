import type { CSSProperties } from 'react';
import type { GroveHome, GroveState } from './groveTypes';
import { Mascot } from './ui';

export function GroveHouse({ kind, className = '' }: { kind: GroveHome; className?: string }) {
  const tree = kind === 'treehouse',
    observatory = kind === 'observatory';
  return (
    <svg
      viewBox="0 0 160 100"
      className={`grove-house ${className}`}
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <ellipse cx="80" cy="94" rx="66" ry="5" fill="#000" opacity=".35" />
      {tree ? (
        <>
          <path d="M64 40H88V100H64Z" fill="#51372d" />
          <path d="M72 40H80V100H72Z" fill="#946044" />
          <path d="M34 34H120V78H34Z" fill="#a86d44" />
          <path d="M34 68H126V78H28V68Z" fill="#5c3a2d" />
          <path d="M24 34V26H34V18H48V10H104V18H118V26H130V36Z" fill="#59634f" />
          <path d="M36 30H118V36H36ZM48 18H104V24H48Z" fill="#889266" />
          <path d="M62 44H82V70H62Z" fill="#35291f" />
          <path d="M92 42H110V58H92Z" fill="#ffcf71" />
          <path d="M96 42H100V58H96ZM92 49H110V52H92Z" fill="#8c552e" />
          <path d="M108 78V100M122 78V100M108 84H122M108 94H122" stroke="#9e7951" strokeWidth="4" />
        </>
      ) : observatory ? (
        <>
          <path d="M36 48H124V92H36Z" fill="#59657e" />
          <path d="M30 44H130V52H30Z" fill="#9aa3b2" />
          <path d="M44 44V28H52V20H68V14H94V20H110V28H118V44Z" fill="#798bab" />
          <path d="M64 20H76V28H64ZM52 30H64V38H52Z" fill="#b3c9df" />
          <path d="M68 64H88V94H68Z" fill="#1e273a" />
          <path d="M44 60H58V76H44ZM102 60H116V76H102Z" fill="#ffd681" />
          <path d="M86 16V6H92V0H112V6H104V12H98V20Z" fill="#e1bd78" />
          <path d="M30 92H132V98H30Z" fill="#303e50" />
        </>
      ) : (
        <>
          <path d="M14 78V66H24V52H36V42H52V34H108V42H126V56H138V70H146V94H14Z" fill="#526052" />
          <path d="M22 66H34V54H48V46H114V54H130V66H138V92H22Z" fill="#758267" />
          <path d="M42 68V58H54V50H106V58H118V68H124V94H36V68Z" fill="#533c30" />
          <path d="M62 94V70H68V62H94V70H100V94Z" fill="#171c21" />
          <path d="M104 64H116V80H104Z" fill="#ffd98c" />
          <path d="M108 64H112V80H108ZM104 70H116V74H104Z" fill="#8c5f34" />
          <path d="M20 84H36V90H20ZM28 56H36V62H28ZM120 52H130V58H120Z" fill="#a3ab75" />
        </>
      )}
      <path d="M12 94H148V98H12Z" fill="#434c3f" />
    </svg>
  );
}

export default function GroveScene({
  state,
  elapsed,
  exploring,
  running,
  onPet,
  message = '',
  large = false,
}: {
  state: GroveState;
  elapsed: number;
  exploring: boolean;
  running: boolean;
  onPet: () => void;
  message?: string;
  large?: boolean;
}) {
  const positions = [
    [43, 79],
    [67, 59],
    [32, 38],
    [62, 16],
    [38, 41],
    [62, 65],
  ];
  const phase = Math.floor(elapsed / 9) % positions.length;
  const [left, top] = positions[phase];
  return (
    <div
      className={`grove-scene ${large ? 'grove-scene-large' : ''} ${running ? 'exploring' : ''} ${message ? 'fox-is-happy' : ''}`}
      data-home={state.home}
      data-skin={state.skin}
    >
      <svg
        className="grove-tree"
        viewBox="0 0 160 560"
        preserveAspectRatio="none"
        fill="none"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <path
          d="M76 0H92V48H86V98H98V146H90V200H78V246H86V298H100V348H92V408H80V464H94V522H106V560H72V526H76V474H64V420H72V362H78V314H66V250H60V196H72V148H78V104H68V52H76Z"
          fill="#413d36"
        />
        <path
          d="M80 0H86V50H80V100H90V148H82V202H70V248H78V300H92V350H84V410H72V466H86V524H94V560"
          stroke="#8b7351"
          strokeWidth="5"
        />
        <path
          d="M72 100H38V88H22M90 176H126V164H144M66 258H36V244H12M92 352H132V338H150M72 430H38V416H16"
          stroke="#66543e"
          strokeWidth="8"
        />
        <path
          d="M84 546V494H70V448H82V390H98V338H84V288H70V228H84V164H96V114H82V58H88V8"
          stroke="#556954"
          strokeWidth="5"
        />
        {[
          [37, 74],
          [127, 151],
          [21, 232],
          [135, 324],
          [26, 401],
          [94, 471],
        ].map(([x, y], i) => (
          <g key={`leaves-${i}`} opacity=".8">
            <path
              d={`M${x - 16} ${y + 7}v-7h10v-6h20v6h10v13h-10v6h-20v-6h-10Z`}
              fill={i % 2 ? '#3b554a' : '#435b4d'}
            />
            <path d={`M${x - 8} ${y}h18v6h-18ZM${x - 14} ${y + 7}h11v6h-11Z`} fill="#748365" />
          </g>
        ))}
        {[
          [80, 35],
          [97, 80],
          [61, 128],
          [97, 218],
          [57, 278],
          [102, 322],
          [66, 375],
          [92, 446],
          [61, 496],
          [118, 166],
          [28, 90],
          [22, 248],
          [134, 340],
          [26, 418],
        ].map(([x, y], i) => (
          <g key={i} opacity={i % 3 === 0 ? '.9' : '.65'}>
            <path
              d={`M${x} ${y}h${i % 2 ? 19 : -19}v8h${i % 2 ? -7 : 7}v5h${i % 2 ? -12 : 12}Z`}
              fill={i % 3 ? '#77855e' : '#adac72'}
            />
          </g>
        ))}
        {[
          [100, 105],
          [46, 225],
          [110, 345],
          [48, 470],
        ].map(([x, y], i) => (
          <g key={`perch-${i}`}>
            <path d={`M${x - 22} ${y}h44v7h-44Z`} fill="#94734a" />
            <path d={`M${x - 16} ${y + 7}h32v4h-32Z`} fill="#453e34" />
            <rect
              x={x + 10}
              y={y - 10}
              width="6"
              height="7"
              fill={i % 2 ? '#b7ce99' : '#cda85c'}
              className="grove-treasure"
            />
          </g>
        ))}
        <path
          d="M76 14H54V8H42V20H28V34H46V28H66V40H102V28H124V34H142V20H126V8H108V14Z"
          fill="#344b44"
        />
        <path d="M44 14H60V20H44ZM98 18H124V24H98ZM66 26H96V32H66Z" fill="#657b58" />
        <g className="grove-lantern">
          <path d="M118 177V190" stroke="#ad9363" strokeWidth="2" />
          <path d="M111 191H125V206H111Z" fill="#a97d43" />
          <path d="M115 194H121V203H115Z" fill="#ffdf92" />
        </g>
        {!large && <path d="M86 528H64V542H10V552H-154" stroke="#66543e" strokeWidth="7" />}
        {state.decorations.includes('lanterns') &&
          [
            [42, 94],
            [137, 176],
            [22, 260],
            [145, 352],
          ].map(([x, y], i) => (
            <g key={`lamp-${i}`} className="grove-lantern">
              <path d={`M${x} ${y - 12}v12`} stroke="#c4a66b" strokeWidth="2" />
              <rect x={x - 6} y={y} width="12" height="15" rx="2" fill="#ffbb55" />
              <rect x={x - 2} y={y + 3} width="4" height="9" fill="#fff1b7" />
            </g>
          ))}
        {state.decorations.includes('flowers') &&
          [
            [78, 52],
            [89, 151],
            [64, 242],
            [96, 328],
            [70, 456],
            [112, 172],
          ].map(([x, y], i) => (
            <g key={`flower-${i}`}>
              <path d={`M${x - 3} ${y - 9}h6v18h-6ZM${x - 9} ${y - 3}h18v6h-18Z`} fill="#f2f3e2" />
              <rect x={x - 2} y={y - 2} width="4" height="4" fill="#d7b475" />
            </g>
          ))}
        {state.decorations.includes('stars') &&
          [
            [32, 132],
            [128, 220],
            [28, 360],
            [128, 452],
          ].map(([x, y], i) => (
            <g key={`star-${i}`}>
              <path d={`M${x} ${y - 23}v23`} stroke="#b6b8bf" strokeWidth="1" />
              <path d={`M${x - 3} ${y - 8}h6v5h5v6h-5v5h-6v-5h-5v-6h5Z`} fill="#fff" />
            </g>
          ))}
      </svg>
      {exploring && (
        <button
          className="grove-travel-fox"
          style={{ '--fox-left': `${left}%`, '--fox-top': `${top}%` } as CSSProperties}
          onClick={onPet}
          aria-label="抚摸探索中的小狐狸"
        >
          <Mascot size={large ? 66 : 48} skin={state.skin} />
          {running && [2, 4].includes(phase) && (
            <span key={Math.floor(elapsed / 9)} className="grove-found" aria-hidden="true">
              ✧ 发现微光
            </span>
          )}
          {message && <span className="grove-speech">{message}</span>}
        </button>
      )}
      {large && (
        <div className="grove-scene-home">
          <GroveHouse kind={state.home} />
          {!exploring && (
            <button className="grove-home-fox" onClick={onPet} aria-label="抚摸小狐狸">
              <Mascot size={64} skin={state.skin} />
              {message && <span className="grove-speech">{message}</span>}
            </button>
          )}
        </div>
      )}
      <i className="grove-firefly firefly-a" />
      <i className="grove-firefly firefly-b" />
    </div>
  );
}
