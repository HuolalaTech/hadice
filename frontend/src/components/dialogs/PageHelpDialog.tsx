import React from 'react'
import { HelpCircle, MessageCircleQuestion } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getHelpContent, type HelpSectionWithTable } from '@/constants/helpContent'
import { getMenuLabel } from '@/constants/menu'

interface PageHelpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  menuId: string
}

export function PageHelpDialog({
  open,
  onOpenChange,
  menuId
}: PageHelpDialogProps): React.JSX.Element {
  const content = getHelpContent(menuId)
  const label = getMenuLabel(menuId)

  if (!content) return <></>

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[65vw] max-w-[65vw] h-[80vh] flex flex-col [&>button]:hidden" style={{ display: 'flex' }}>
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" />
            {label} — 帮助
          </DialogTitle>
          <DialogDescription className="sr-only">
            {label}页面的功能介绍、使用指导和常见问题解答
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 overflow-y-auto pr-4">
          <div className="space-y-5 pb-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {content.description}
            </p>

            <Separator />

            {content.sections.map((section, idx) => {
              const sectionWithTable = section as HelpSectionWithTable

              if (sectionWithTable.table) {
                return (
                  <section key={idx}>
                    <h3 className="text-sm font-semibold mb-2">{section.title}</h3>
                    {section.content && (
                      <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                        {section.content}
                      </p>
                    )}
                    <div className="border rounded-md">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[140px]">对比项</TableHead>
                            <TableHead>Sophon 模式</TableHead>
                            <TableHead>HiProfiler 模式</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sectionWithTable.table.map((row, rowIdx) => (
                            <TableRow key={rowIdx}>
                              <TableCell className="font-medium">{row.label}</TableCell>
                              <TableCell>{row.sophon}</TableCell>
                              <TableCell>{row.hiprofiler}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </section>
                )
              }

              const isArray = Array.isArray(section.content)

              return (
                <section key={idx}>
                  <h3 className="text-sm font-semibold mb-2">{section.title}</h3>
                  {isArray ? (
                    <div className="text-sm text-muted-foreground leading-relaxed pl-4 space-y-1">
                      {(section.content as string[]).map((line, lineIdx) => (
                        <p key={lineIdx}>{line || <br />}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground leading-relaxed pl-4">
                      {section.content}
                    </p>
                  )}
                </section>
              )
            })}

            {content.faqs.length > 0 && (
              <>
                <Separator />
                <section>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                    <MessageCircleQuestion className="h-4 w-4 text-primary" />
                    常见问题
                  </h3>
                  <div className="space-y-4 pl-4">
                    {content.faqs.map((faq, idx) => (
                      <div key={idx}>
                        <p className="text-sm font-medium mb-1">Q: {faq.question}</p>
                        <div className="text-sm text-muted-foreground pl-4 space-y-1">
                          {faq.answer.split('\n').map((line, lineIdx) => (
                            <p key={lineIdx}>{line || <br />}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
