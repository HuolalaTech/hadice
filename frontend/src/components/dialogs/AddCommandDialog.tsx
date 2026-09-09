import React, { useState } from 'react'
import { X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface AddCommandDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (name: string, command: string) => void
}

/**
 * 添加快捷命令对话框
 */
export function AddCommandDialog({
  open,
  onOpenChange,
  onAdd
}: AddCommandDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')

  const handleSubmit = () => {
    if (name.trim() && command.trim()) {
      onAdd(name.trim(), command.trim())
      setName('')
      setCommand('')
      onOpenChange(false)
    }
  }

  const handleCancel = () => {
    setName('')
    setCommand('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>添加快捷命令</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium leading-none">
              命令名
            </label>
            <Input
              id="name"
              placeholder="例如：重启"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSubmit()
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="command" className="text-sm font-medium leading-none">
              实际命令
            </label>
            <Input
              id="command"
              placeholder="例如：hdc shell reboot"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSubmit()
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              命令将直接输入到终端，按回车键执行
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || !command.trim()}>
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

