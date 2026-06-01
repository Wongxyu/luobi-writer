import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'

const app = createApp(App)

app.config.errorHandler = (err, _instance, info) => {
  document.body.innerHTML = `<pre style="padding:2rem;color:red;font-family:monospace">Error: ${String(err)}\n\nInfo: ${info}</pre>`
}

window.addEventListener('unhandledrejection', (e) => {
  document.body.innerHTML = `<pre style="padding:2rem;color:red;font-family:monospace">Promise Rejection: ${String(e.reason)}</pre>`
})

try {
  app.mount('#app')
} catch (e) {
  document.body.innerHTML = `<pre style="padding:2rem;color:red;font-family:monospace">Mount Error: ${String(e)}</pre>`
}
