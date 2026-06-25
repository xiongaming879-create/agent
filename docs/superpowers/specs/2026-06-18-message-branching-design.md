# Message Branching Design

## Problem

用户编辑消息或重新生成回复时，不应丢失原有历史，而应创建分支保留所有探索路径。消息以树结构组织，支持分支切换。

## Design

### 消息树结构

- 消息通过 `parent_id` 构成树
- 同一 `parent_id` 下可有多个子消息（分支）
- 前端展示当前活跃分支，用户可切换分支

### 分支导航 (BranchNavigator)

- 单条消息时隐藏分支导航（`siblings.length <= 1`）
- 多条分支时显示导航 `1/3`，使用 SVG chevron 图标
- 切换分支更新活跃消息（点击 chevron 图标更新 `activeIndex`）

### 编辑用户消息

- 编辑用户消息时，在原消息下创建新分支节点，旧分支保留
- 编辑功能已移除，仅保留分支数据结构

### 重新生成

- 重新生成最后一条助手消息时，同样创建新分支

### 活跃分支路径

- 从叶子节点回溯到根，构建活跃分支路径（`getActiveBranch`）
- 切换分支：选择不同子节点构建不同路径

## Acceptance Criteria

- 从叶子节点回溯到根，构建活跃分支路径
- 同一 `parent_id` 下多个子消息构成分支
- 切换分支选择不同子节点构建不同路径
- 编辑用户消息创建新分支节点
- 单条消息时隐藏分支导航
- 多条分支时显示导航 `1/3`，SVG chevron 图标
- 切换分支更新活跃消息

## Changes by File

### `client/src/stores/message.ts`

消息树结构管理：分支路径、切换、活跃分支

### `client/src/components/BranchNavigator.vue`

分支切换 UI：`< 1/3 >` 导航

### `client/src/components/MessageBubble.vue`

分支导航集成到消息气泡

## What This Enables

- 探索式对话不丢失历史
- 多种回答对比
- 灵活的对话路径管理

## What This Drops

- 编辑功能（已移除，仅保留分支数据结构）
