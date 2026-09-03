# CI 冒烟用 loopback 媒体服务（任务 9.8）：把夹具目录以支持 Range 请求的
# HTTP 暴露在 127.0.0.1:8790。模拟器与宿主共享网络栈，应用内自测的
# remote_stream_playback 用例从这里装载音频流——生产播放链
# 「远程 http URL → TrackPlayer.add → AVPlayer 装载」的确定性运行时
# 证据，零外网依赖。
#
# 必须支持 Range（python 自带 http.server 不支持）：AVPlayer 流式装载
# 首包即发 Range 请求，200 全量响应也能播，但 206 是生产直链
# （car-er.kuwo.cn 等）的真实行为，探针口径与之一致。
#
# 用法：python3 range-http-server.py <目录> [端口]
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8790


class RangeRequestHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            self.send_error(404, 'File not found')
            return None
        total = os.path.getsize(path)
        rng = self.headers.get('Range')
        if not rng or not rng.startswith('bytes='):
            f = open(path, 'rb')
            self.send_response(200)
            self.send_header('Content-Length', str(total))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Type', self.guess_type(path))
            self.end_headers()
            return f
        try:
            spec = rng.split('=', 1)[1].split(',')[0].strip()
            start_s, _, end_s = spec.partition('-')
            start = int(start_s) if start_s else 0
            end = int(end_s) if end_s else total - 1
            end = min(end, total - 1)
            if start > end or start >= total:
                self.send_error(416, 'Requested Range Not Satisfiable')
                self.send_header('Content-Range', f'bytes */{total}')
                self.end_headers()
                return None
        except ValueError:
            self.send_error(400, 'Bad Range')
            return None
        length = end - start + 1
        f = open(path, 'rb')
        f.seek(start)
        self.send_response(206)
        self.send_header('Content-Range', f'bytes {start}-{end}/{total}')
        self.send_header('Content-Length', str(length))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Type', self.guess_type(path))
        self.end_headers()
        return f

    def do_GET(self):
        f = self.send_head()
        if f is None:
            return
        try:
            self.copyfile(f, self.wfile)
        finally:
            f.close()

    do_HEAD = do_GET

    def log_message(self, fmt, *args):
        sys.stdout.write('[range-server] %s\n' % (fmt % args))
        sys.stdout.flush()


if __name__ == '__main__':
    os.chdir(sys.argv[1])
    server = ThreadingHTTPServer(('127.0.0.1', PORT), RangeRequestHandler)
    print(f'[range-server] serving {sys.argv[1]} on 127.0.0.1:{PORT}')
    sys.stdout.flush()
    server.serve_forever()
