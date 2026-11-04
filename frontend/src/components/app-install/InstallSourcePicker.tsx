import { useEffect, useRef, useState, type JSX } from 'react'
import { Download, FolderOpen, Loader2, QrCode } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { validateInstallPackageUrl } from '@/lib/install-url'
import { decodeQrFromBlob, extractHttpUrl, pickClipboardImage } from '@/lib/qr-decode'
import type { InstallPlatform, InstallSourceType } from '@/types/install'

interface PropsInstallSourcePicker {
  readonly platform: InstallPlatform
  readonly sourceType: InstallSourceType
  readonly url: string
  readonly isLocalBusy: boolean
  readonly isUrlWorking: boolean
  readonly onSourceTypeChange: (sourceType: InstallSourceType) => void
  readonly onUrlChange: (url: string) => void
  readonly onSelectFile: () => void
  readonly onDownload: (url?: string) => void
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(blob)
  })
}

export function InstallSourcePicker({
  platform,
  sourceType,
  url,
  isLocalBusy,
  isUrlWorking,
  onSourceTypeChange,
  onUrlChange,
  onSelectFile,
  onDownload
}: PropsInstallSourcePicker): JSX.Element {
  const [isDecodingQr, setIsDecodingQr] = useState(false)
  const [qrPreview, setQrPreview] = useState<string | null>(null)
  const decodingQrRef = useRef(false)
  const handleSourceTypeChange = (value: string): void => {
    onSourceTypeChange(value as InstallSourceType)
  }
  const urlError = url.trim() ? validateInstallPackageUrl(url, platform) : null

  useEffect(() => {
    if (sourceType !== 'url') setQrPreview(null)
  }, [sourceType])

  useEffect(() => {
    if (sourceType !== 'url' || isUrlWorking) return
    const onPaste = (event: ClipboardEvent): void => {
      const file = pickClipboardImage(event)
      if (!file || decodingQrRef.current) return
      event.preventDefault()
      decodingQrRef.current = true
      setIsDecodingQr(true)
      void (async () => {
        try {
          // 先出预览，再解码——用户立刻能看到刚粘贴的图
          const preview = await readBlobAsDataUrl(file)
          setQrPreview(preview)
          const payload = await decodeQrFromBlob(file)
          if (!payload) {
            toast.error('未识别到二维码')
            return
          }
          const recognizedUrl = extractHttpUrl(payload)
          if (!recognizedUrl) {
            toast.error('二维码不是 HTTP/HTTPS 链接')
            return
          }
          onUrlChange(recognizedUrl)
          const recognizedError = validateInstallPackageUrl(recognizedUrl, platform)
          if (recognizedError) {
            toast.error(recognizedError)
            return
          }
          toast.success('已识别安装包链接，开始下载安装')
          onDownload(recognizedUrl)
        } catch (error: unknown) {
          toast.error(error instanceof Error ? error.message : '二维码识别失败')
        } finally {
          decodingQrRef.current = false
          setIsDecodingQr(false)
        }
      })()
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [isUrlWorking, onDownload, onUrlChange, platform, sourceType])
  const placeholder =
    platform === 'android'
      ? 'https://cdn.example/app.apk 或带签名参数的下载链接'
      : 'https://cdn.example/app.hap 或带签名参数的 .hsp/.har/.zip 链接'

  return (
    <Tabs value={sourceType} onValueChange={handleSourceTypeChange}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="local" disabled={isUrlWorking}>
          本地文件
        </TabsTrigger>
        <TabsTrigger value="url">安装包链接</TabsTrigger>
      </TabsList>

      <TabsContent value="local" className="pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onSelectFile}
          disabled={isLocalBusy || isUrlWorking}
          aria-label="选择安装包"
        >
          <FolderOpen className="mr-2 h-4 w-4" aria-hidden="true" />
          选择安装包
        </Button>
      </TabsContent>

      <TabsContent value="url" className="space-y-3 pt-2">
        <Input
          type="url"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder={placeholder}
          aria-label="安装包链接"
          aria-invalid={urlError !== null}
          disabled={isDecodingQr}
        />
        <p
          className={cn(
            'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium',
            isDecodingQr
              ? 'border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200'
              : 'border-orange-500/45 bg-orange-500/10 text-orange-800 dark:border-orange-400/40 dark:text-orange-200'
          )}
        >
          <QrCode className="h-4 w-4 shrink-0" aria-hidden="true" />
          {isDecodingQr
            ? '正在识别二维码…'
            : '可 ⌘V / Ctrl+V 粘贴二维码图片，识别链接后自动下载安装'}
        </p>
        {qrPreview && (
          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-2">
            <img
              src={qrPreview}
              alt="粘贴的二维码"
              className="h-28 w-28 shrink-0 rounded border border-border bg-white object-contain"
            />
            <div className="min-w-0 flex-1 space-y-2 pt-0.5">
              <p className="text-xs font-medium text-foreground">已粘贴二维码</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground" title={url || undefined}>
                {url.trim() || (isDecodingQr ? '识别中…' : '未识别到链接')}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={isDecodingQr || isUrlWorking}
                onClick={() => setQrPreview(null)}
              >
                清除预览
              </Button>
            </div>
          </div>
        )}
        {urlError && (
          <p className="text-sm text-destructive" role="alert">
            {urlError}
          </p>
        )}
        <button
          type="button"
          onClick={() => onDownload()}
          disabled={isUrlWorking || isDecodingQr || url.trim().length === 0 || urlError !== null}
          aria-label={isUrlWorking ? '正在下载并安装' : '下载并解析安装包'}
          aria-busy={isUrlWorking}
          style={{
            // ponytail: 圆用 20px（高的一半）而不是 9999；9999→6 视觉变化全挤在最后一段
            width: isUrlWorking ? 40 : 140,
            borderRadius: isUrlWorking ? 20 : 6,
            // 展开时圆角先收完，宽度后到位，末段不再「突然变方」
            transition: isUrlWorking
              ? 'width 0.65s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.55s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.4s ease, opacity 0.2s ease'
              : 'width 0.75s cubic-bezier(0.22, 1, 0.36, 1), border-radius 0.4s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.4s ease, opacity 0.2s ease'
          }}
          className={cn(
            'relative inline-flex h-10 shrink-0 items-center justify-center overflow-hidden',
            'bg-primary text-primary-foreground',
            'disabled:pointer-events-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            isUrlWorking ? 'shadow-md' : 'shadow-sm',
            !isUrlWorking && (url.trim().length === 0 || urlError !== null) && 'opacity-45'
          )}
        >
          <span
            className={cn(
              'absolute inset-0 flex items-center justify-center gap-2 px-4 text-sm font-medium',
              'transition-[opacity,transform] duration-500 ease-out',
              // 还原时立刻淡入，与转圈叠化，避免中间空一帧闪白
              isUrlWorking
                ? 'pointer-events-none scale-[0.92] opacity-0 duration-300 ease-in'
                : 'scale-100 opacity-100'
            )}
            aria-hidden={isUrlWorking}
          >
            <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">下载并解析</span>
          </span>
          <span
            className={cn(
              'absolute inset-0 flex items-center justify-center',
              'transition-[opacity,transform] duration-500 ease-out',
              isUrlWorking
                ? 'scale-100 opacity-100 delay-100'
                : 'pointer-events-none scale-90 opacity-0 duration-300 ease-in'
            )}
            aria-hidden={!isUrlWorking}
          >
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          </span>
        </button>
      </TabsContent>
    </Tabs>
  )
}
