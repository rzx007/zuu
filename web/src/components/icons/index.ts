import { HugeiconsIcon, type IconArray } from '@hugeicons/vue'
import {
  AlertCircleIcon as alertCircleIcon,
  AiBrowserIcon as aiBrowserIcon,
  AiChat01Icon as aiChat01Icon,
  ArrowDown01Icon as arrowDown01Icon,
  ArrowLeft01Icon as arrowLeft01Icon,
  ArrowRight01Icon as arrowRight01Icon,
  ArrowUp01Icon as arrowUp01Icon,
  AttachmentIcon as attachmentIcon,
  BookIcon as bookIcon,
  BookmarkIcon as bookmarkIcon,
  BotIcon as botIcon,
  BrainIcon as brainIcon,
  Cancel01Icon as cancel01Icon,
  CancelCircleIcon as cancelCircleIcon,
  Calendar03Icon as calendar03Icon,
  CheckmarkCircle01Icon as checkmarkCircle01Icon,
  CircleIcon as circleIcon,
  CircleSmallIcon as circleSmallIcon,
  ClockIcon as clockIcon,
  CodeIcon as codeIcon,
  Copy01Icon as copy01Icon,
  CornerDownLeftIcon as cornerDownLeftIcon,
  Delete02Icon as delete02Icon,
  DotIcon as dotIcon,
  ExternalLinkIcon as externalLinkIcon,
  EyeIcon as eyeIcon,
  EyeOffIcon as eyeOffIcon,
  FemaleSymbolIcon as femaleSymbolIcon,
  File01Icon as file01Icon,
  File02Icon as file02Icon,
  FolderIcon as folderIcon,
  FolderOpenIcon as folderOpenIcon,
  GitCommitIcon as gitCommitIcon,
  GlobalIcon as globalIcon,
  Image01Icon as image01Icon,
  Loading03Icon as loading03Icon,
  MaleSymbolIcon as maleSymbolIcon,
  MessageMultiple01Icon as messageMultiple01Icon,
  MicIcon as micIcon,
  MinusSignIcon as minusSignIcon,
  MusicNote01Icon as musicNote01Icon,
  PackageIcon as packageIcon,
  PauseIcon as pauseIcon,
  PlayIcon as playIcon,
  PlusSignIcon as plusSignIcon,
  SearchIcon as searchIcon,
  Settings01Icon as settings01Icon,
  SquareIcon as squareIcon,
  TerminalIcon as terminalIcon,
  Tick02Icon as tick02Icon,
  UnfoldMoreIcon as unfoldMoreIcon,
  UserIcon as userIcon,
  Video01Icon as video01Icon,
  WorkflowSquare01Icon as workflowSquare01Icon,
  WrenchIcon as wrenchIcon,
} from '@hugeicons/core-free-icons'
import { defineComponent, h, type Component } from 'vue'

export type LucideIcon = Component

function createIconComponent(icon: unknown) {
  return defineComponent({
    inheritAttrs: false,
    props: {
      size: {
        type: [Number, String],
        default: 24,
      },
      color: {
        type: String,
        default: 'currentColor',
      },
      strokeWidth: {
        type: Number,
        default: undefined,
      },
      absoluteStrokeWidth: {
        type: Boolean,
        default: false,
      },
    },
    setup(props, { attrs }) {
      return () =>
        h(HugeiconsIcon, {
          ...attrs,
          icon: icon as IconArray,
          size: props.size,
          color: props.color,
          strokeWidth: props.strokeWidth,
          absoluteStrokeWidth: props.absoluteStrokeWidth,
        })
    },
  })
}

export const AlertCircleIcon = createIconComponent(alertCircleIcon)
export const AiBrowserIcon = createIconComponent(aiBrowserIcon)
export const AiChat01Icon = createIconComponent(aiChat01Icon)
export const ArrowDown01Icon = createIconComponent(arrowDown01Icon)
export const ArrowLeft01Icon = createIconComponent(arrowLeft01Icon)
export const ArrowRight01Icon = createIconComponent(arrowRight01Icon)
export const ArrowUp01Icon = createIconComponent(arrowUp01Icon)
export const AttachmentIcon = createIconComponent(attachmentIcon)
export const BookIcon = createIconComponent(bookIcon)
export const BookmarkIcon = createIconComponent(bookmarkIcon)
export const BotIcon = createIconComponent(botIcon)
export const BrainIcon = createIconComponent(brainIcon)
export const Cancel01Icon = createIconComponent(cancel01Icon)
export const Calendar03Icon = createIconComponent(calendar03Icon)
export const CheckCircleIcon = createIconComponent(checkmarkCircle01Icon)
export const CheckCircle2 = CheckCircleIcon
export const CircleIcon = createIconComponent(circleIcon)
export const CircleSmallIcon = createIconComponent(circleSmallIcon)
export const ClockIcon = createIconComponent(clockIcon)
export const Code = createIconComponent(codeIcon)
export const CodeIcon = Code
export const Copy01Icon = createIconComponent(copy01Icon)
export const CornerDownLeftIcon = createIconComponent(cornerDownLeftIcon)
export const Delete02Icon = createIconComponent(delete02Icon)
export const DotIcon = createIconComponent(dotIcon)
export const ExternalLinkIcon = createIconComponent(externalLinkIcon)
export const EyeIcon = createIconComponent(eyeIcon)
export const EyeOffIcon = createIconComponent(eyeOffIcon)
export const File01Icon = createIconComponent(file01Icon)
export const File02Icon = createIconComponent(file02Icon)
export const FolderIcon = createIconComponent(folderIcon)
export const FolderOpenIcon = createIconComponent(folderOpenIcon)
export const GitCommitIcon = createIconComponent(gitCommitIcon)
export const GlobalIcon = createIconComponent(globalIcon)
export const Image01Icon = createIconComponent(image01Icon)
export const Loading03Icon = createIconComponent(loading03Icon)
export const MarsIcon = createIconComponent(maleSymbolIcon)
export const MarsStrokeIcon = MarsIcon
export const MessageCircleIcon = createIconComponent(messageMultiple01Icon)
export const MicIcon = createIconComponent(micIcon)
export const MinusSignIcon = createIconComponent(minusSignIcon)
export const Music2Icon = createIconComponent(musicNote01Icon)
export const NonBinaryIcon = createIconComponent(dotIcon)
export const PackageIcon = createIconComponent(packageIcon)
export const PauseIcon = createIconComponent(pauseIcon)
export const PlayIcon = createIconComponent(playIcon)
export const PlusSignIcon = createIconComponent(plusSignIcon)
export const SearchIcon = createIconComponent(searchIcon)
export const Settings01Icon = createIconComponent(settings01Icon)
export const SquareIcon = createIconComponent(squareIcon)
export const TerminalIcon = createIconComponent(terminalIcon)
export const Tick02Icon = createIconComponent(tick02Icon)
export const TransgenderIcon = createIconComponent(userIcon)
export const UnfoldMoreIcon = createIconComponent(unfoldMoreIcon)
export const VenusAndMarsIcon = createIconComponent(userIcon)
export const VenusIcon = createIconComponent(femaleSymbolIcon)
export const Video01Icon = createIconComponent(video01Icon)
export const WorkflowSquare01Icon = createIconComponent(workflowSquare01Icon)
export const WrenchIcon = createIconComponent(wrenchIcon)
export const XCircleIcon = createIconComponent(cancelCircleIcon)
export const XCircle = XCircleIcon
