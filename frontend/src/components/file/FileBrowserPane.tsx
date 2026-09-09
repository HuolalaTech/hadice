import React from 'react'
import { ArrowUp, Home, RefreshCw, File, Folder, ExternalLink, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PathInputWithHistory } from './PathInputWithHistory'
import { formatFileSize, formatDateTime } from '@/lib/format'
import { isHdcAvailable } from '@/lib/hdc'
import type { FileItem } from '@/types/hdc'

/**
 * 文件浏览器窗格组件
 */
export function FileBrowserPane({
  title,
  icon: Icon,
  path,
  pathInput,
  files,
  loading,
  error,
  selectedFiles,
  scrollAreaRef,
  onPathInputChange,
  onPathInputSubmit,
  onPathInputKeyDown,
  onNavigateUp,
  onNavigateHome,
  onRefresh,
  onFileClick,
  showOpenButton = false,
  actionButton,
  pathHistory = [],
  onPathHistorySelect,
  onRemovePathHistory,
  isDevice = false,
  onDeleteFile
}: {
  title: string
  icon: React.ElementType
  path: string
  pathInput: string
  files: FileItem[]
  loading: boolean
  error: string | null
  selectedFiles: Set<string>
  scrollAreaRef: React.RefObject<HTMLDivElement | null>
  onPathInputChange: (value: string) => void
  onPathInputSubmit: () => void
  onPathInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onNavigateUp: () => void
  onNavigateHome: () => void
  onRefresh: () => void
  onFileClick: (file: FileItem) => void
  showOpenButton?: boolean
  actionButton?: React.ReactNode
  pathHistory?: string[]
  onPathHistorySelect: (path: string) => void
  onRemovePathHistory: (path: string) => void
  isDevice?: boolean
  onDeleteFile?: (file: FileItem) => void
}): React.JSX.Element {
  return (
    <Card className="flex-1 flex flex-col min-w-0">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Icon className="h-4 w-4" />
            {title}
          </CardTitle>
          {actionButton}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col min-h-0 p-4 pt-0">
        {/* 路径栏 */}
        <div className="mb-3 flex items-center gap-2">
          <PathInputWithHistory
            value={pathInput}
            onChange={onPathInputChange}
            onSubmit={onPathInputSubmit}
            onKeyDown={onPathInputKeyDown}
            placeholder="输入路径..."
            history={pathHistory}
            onHistorySelect={onPathHistorySelect}
            onRemoveHistory={onRemovePathHistory}
          />
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNavigateUp}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNavigateHome}>
              <Home className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* 文件列表 */}
        <ScrollArea className="flex-1" ref={scrollAreaRef}>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-32 text-destructive">
              {error}
            </div>
          ) : files.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              目录为空
            </div>
          ) : (
            <div className="space-y-1">
              {files.map((file) => {
                const isSelected = selectedFiles.has(file.path)
                return (
                  <div
                    key={file.path}
                    className={`
                      group flex items-center gap-2 p-2 rounded-lg transition-colors
                      ${isSelected ? 'bg-primary/20 border border-primary/30' : 'hover:bg-accent'}
                    `}
                  >
                    <div
                      onClick={() => onFileClick(file)}
                      className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
                    >
                      {file.isDirectory ? (
                        <Folder className="h-5 w-5 text-blue-500 flex-shrink-0" />
                      ) : (
                        <File className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{file.name}</div>
                        {!file.isDirectory && (
                          <div className="text-xs text-muted-foreground">
                            {formatFileSize(file.size)} • {formatDateTime(file.modifiedTime)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {showOpenButton && !file.isDirectory && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-accent hover:text-accent-foreground"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (isHdcAvailable()) {
                              window.hdc.openFileInSystem(file.path)
                            }
                          }}
                          title="在系统中打开"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                      {!file.isDirectory && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-destructive/20 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (onDeleteFile) {
                              onDeleteFile(file)
                            }
                          }}
                          title="删除文件"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

