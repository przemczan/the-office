import * as React from 'react';
export interface SidebarItem{id: string;label: string;/** Lucide name */icon?: string;/** count shown as mono chip */badge?: React.ReactNode;}
export interface SidebarSection{title?: string;items: SidebarItem[];}
/**
 * App navigation rail for back-office apps — logo header, grouped items, user footer. 240px, 56px collapsed.
 * @startingPoint section="Navigation" subtitle="Sidebar, topbar, page header, tabs, breadcrumbs, pagination" viewport="700x460"
 */
export interface SidebarProps{
  header?: React.ReactNode;
  sections?: SidebarSection[];
  activeId?: string;
  onSelect?: (id: string) => void;
  footer?: React.ReactNode;
  collapsed?: boolean;
  style?: React.CSSProperties;
}
export declare function Sidebar(props: SidebarProps): JSX.Element;
