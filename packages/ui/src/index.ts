// The design system for React: each component of design-system/components, typed by its .d.ts.
// design-system/ stays as exported, so nothing outside this package imports it.
import { icons } from "lucide";
import type { JSX as ReactJSX } from "react";

declare global {
  // The .d.ts files return the global JSX.Element, which React 19's types no longer declare;
  // without it every component would return `any`.
  namespace JSX {
    type Element = ReactJSX.Element;
  }

  interface Window {
    lucide?: { readonly icons: typeof icons };
  }
}

// Icon draws from a global Lucide (design-system/readme.md, Iconography), meant to come from a CDN.
// The Office serves itself on localhost, so the same pinned version is bundled and set here, before
// any Icon renders. Icons are looked up by name, so the whole set is kept.
if (typeof window !== "undefined") window.lucide = { icons };

export {
  BarChart,
  type BarChartProps,
  type BarSeries,
} from "../../../design-system/components/charts/BarChart.jsx";
export {
  DonutChart,
  type DonutChartProps,
  type DonutDatum,
} from "../../../design-system/components/charts/DonutChart.jsx";
export {
  LineChart,
  type ChartSeries,
  type LineChartProps,
} from "../../../design-system/components/charts/LineChart.jsx";
export {
  Sparkline,
  type SparklineProps,
} from "../../../design-system/components/charts/Sparkline.jsx";
export { Avatar, type AvatarProps } from "../../../design-system/components/core/Avatar.jsx";
export { Badge, type BadgeProps } from "../../../design-system/components/core/Badge.jsx";
export { Button, type ButtonProps } from "../../../design-system/components/core/Button.jsx";
export { Card, type CardProps } from "../../../design-system/components/core/Card.jsx";
export { Icon, type IconProps } from "../../../design-system/components/core/Icon.jsx";
export {
  IconButton,
  type IconButtonProps,
} from "../../../design-system/components/core/IconButton.jsx";
export { Logo, type LogoProps } from "../../../design-system/components/core/Logo.jsx";
export { Tag, type TagProps } from "../../../design-system/components/core/Tag.jsx";
export {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
} from "../../../design-system/components/data/DataTable.jsx";
export {
  DescriptionList,
  type DescriptionItem,
  type DescriptionListProps,
} from "../../../design-system/components/data/DescriptionList.jsx";
export {
  ProgressBar,
  type ProgressBarProps,
} from "../../../design-system/components/data/ProgressBar.jsx";
export { StatCard, type StatCardProps } from "../../../design-system/components/data/StatCard.jsx";
export {
  Timeline,
  type TimelineItem,
  type TimelineProps,
} from "../../../design-system/components/data/Timeline.jsx";
export { Alert, type AlertProps } from "../../../design-system/components/feedback/Alert.jsx";
export {
  EmptyState,
  type EmptyStateProps,
} from "../../../design-system/components/feedback/EmptyState.jsx";
export {
  Skeleton,
  type SkeletonProps,
} from "../../../design-system/components/feedback/Skeleton.jsx";
export { Toast, type ToastProps } from "../../../design-system/components/feedback/Toast.jsx";
export { Checkbox, type CheckboxProps } from "../../../design-system/components/forms/Checkbox.jsx";
export {
  Field,
  Input,
  type FieldProps,
  type InputProps,
} from "../../../design-system/components/forms/Input.jsx";
export {
  Radio,
  RadioGroup,
  type RadioGroupOption,
  type RadioGroupProps,
  type RadioProps,
} from "../../../design-system/components/forms/Radio.jsx";
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from "../../../design-system/components/forms/SegmentedControl.jsx";
export {
  Select,
  type SelectOption,
  type SelectProps,
} from "../../../design-system/components/forms/Select.jsx";
export { Switch, type SwitchProps } from "../../../design-system/components/forms/Switch.jsx";
export { Textarea, type TextareaProps } from "../../../design-system/components/forms/Textarea.jsx";
export {
  Breadcrumbs,
  type BreadcrumbItem,
  type BreadcrumbsProps,
} from "../../../design-system/components/navigation/Breadcrumbs.jsx";
export {
  PageHeader,
  type PageHeaderProps,
} from "../../../design-system/components/navigation/PageHeader.jsx";
export {
  Pagination,
  type PaginationProps,
} from "../../../design-system/components/navigation/Pagination.jsx";
export {
  Sidebar,
  type SidebarItem,
  type SidebarProps,
  type SidebarSection,
} from "../../../design-system/components/navigation/Sidebar.jsx";
export {
  Tabs,
  type TabItem,
  type TabsProps,
} from "../../../design-system/components/navigation/Tabs.jsx";
export { Topbar, type TopbarProps } from "../../../design-system/components/navigation/Topbar.jsx";
export { Dialog, type DialogProps } from "../../../design-system/components/overlays/Dialog.jsx";
export { Drawer, type DrawerProps } from "../../../design-system/components/overlays/Drawer.jsx";
export {
  Menu,
  type MenuItem,
  type MenuProps,
} from "../../../design-system/components/overlays/Menu.jsx";
export { Tooltip, type TooltipProps } from "../../../design-system/components/overlays/Tooltip.jsx";
