import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Chrome, 
  Cpu, 
  Settings, 
  Code2, 
  Download, 
  ExternalLink, 
  ShieldCheck,
  Zap,
  Terminal,
  FileJson,
  FileCode,
  Layout
} from 'lucide-react';

export default function App() {
  const [activeFile, setActiveFile] = useState('manifest.json');

  const files = {
    'manifest.json': { icon: <FileJson className="w-4 h-4" />, lang: 'json' },
    'popup.html': { icon: <Layout className="w-4 h-4" />, lang: 'html' },
    'popup.css': { icon: <Code2 className="w-4 h-4" />, lang: 'css' },
    'popup.js': { icon: <FileCode className="w-4 h-4" />, lang: 'javascript' },
    'content.js': { icon: <FileCode className="w-4 h-4" />, lang: 'javascript' },
    'background.js': { icon: <Terminal className="w-4 h-4" />, lang: 'javascript' },
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans selection:bg-indigo-500/30">
      {/* Hero Section */}
      <header className="relative overflow-hidden border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-purple-500/10" />
        <div className="max-w-7xl mx-auto px-6 py-16 relative z-10">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 mb-6"
          >
            <div className="p-2 bg-indigo-500/20 rounded-lg border border-indigo-500/30">
              <Chrome className="w-6 h-6 text-indigo-400" />
            </div>
            <span className="text-sm font-semibold uppercase tracking-widest text-indigo-400">Chrome Extension Project</span>
          </motion.div>
          
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-5xl md:text-7xl font-bold text-white mb-6 tracking-tight"
          >
            BYOM <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">AI Agent</span>
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-xl text-slate-400 max-w-2xl leading-relaxed"
          >
            A lightweight, privacy-first browser agent that brings your own models (Gemini or Ollama) directly to your browsing experience.
          </motion.p>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-wrap gap-4 mt-10"
          >
            <button className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-indigo-500/25 flex items-center gap-2">
              <Download className="w-5 h-5" />
              Download Source
            </button>
            <a 
              href="https://ai.google.dev/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl transition-all border border-slate-700 flex items-center gap-2"
            >
              <ExternalLink className="w-5 h-5" />
              Get Gemini Key
            </a>
          </motion.div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Features Column */}
          <div className="space-y-8">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Zap className="w-6 h-6 text-yellow-400" />
              Key Features
            </h2>
            
            <div className="space-y-4">
              {[
                { title: 'Autonomous Agent Loop', desc: 'Executes multi-step tasks by clicking, typing, and scrolling.', icon: <Zap /> },
                { title: 'DOM Annotation', desc: 'Visualizes interactive elements with unique IDs for AI mapping.', icon: <Layout /> },
                { title: 'Live Execution Log', desc: 'Watch the AI\'s thought process and actions in real-time.', icon: <Terminal /> },
                { title: 'Local & Cloud LLMs', desc: 'Seamlessly switch between Gemini 1.5 Flash and Ollama.', icon: <Cpu /> },
              ].map((feature, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="p-6 bg-slate-900/50 border border-slate-800 rounded-2xl hover:border-indigo-500/50 transition-colors group"
                >
                  <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center mb-4 group-hover:bg-indigo-500/20 transition-colors">
                    {React.cloneElement(feature.icon as React.ReactElement, { className: "w-5 h-5 text-indigo-400" })}
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{feature.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Code Preview Column */}
          <div className="lg:col-span-2 space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <Code2 className="w-6 h-6 text-indigo-400" />
                Source Code
              </h2>
              <div className="flex gap-2 p-1 bg-slate-900 rounded-lg border border-slate-800 overflow-x-auto max-w-full">
                {Object.keys(files).map((file) => (
                  <button
                    key={file}
                    onClick={() => setActiveFile(file)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
                      activeFile === file 
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' 
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {files[file as keyof typeof files].icon}
                    {file}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl blur opacity-20 group-hover:opacity-30 transition duration-1000"></div>
              <div className="relative bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
                <div className="flex items-center gap-1.5 px-4 py-3 border-b border-slate-800 bg-slate-900/50">
                  <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></div>
                  <span className="ml-2 text-xs text-slate-500 font-mono">{activeFile}</span>
                </div>
                <div className="p-6 overflow-x-auto">
                  <pre className="text-sm font-mono text-indigo-300 leading-relaxed">
                    <code>
                      {/* This is a placeholder for the actual code display logic */}
                      {`// View /extension/${activeFile} for the full source code.`}
                      {`\n// This project is structured as a Manifest V3 Chrome Extension.`}
                      {`\n// It includes a background service worker, content script, and popup UI.`}
                    </code>
                  </pre>
                </div>
              </div>
            </div>

            {/* Setup Instructions */}
            <div className="p-8 bg-indigo-900/10 border border-indigo-500/20 rounded-3xl mb-8">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Terminal className="w-5 h-5 text-indigo-400" />
                Installation Guide
              </h3>
              <ol className="space-y-4 text-slate-400">
                <li className="flex gap-4">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold border border-indigo-500/30">1</span>
                  <p>Download the <code className="text-indigo-300">/extension</code> directory from this project.</p>
                </li>
                <li className="flex gap-4">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold border border-indigo-500/30">2</span>
                  <p>Open Chrome and navigate to <code className="text-indigo-300">chrome://extensions</code>.</p>
                </li>
                <li className="flex gap-4">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold border border-indigo-500/30">3</span>
                  <p>Enable <span className="text-white font-semibold">Developer mode</span> in the top right corner.</p>
                </li>
                <li className="flex gap-4">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold border border-indigo-500/30">4</span>
                  <p>Click <span className="text-white font-semibold">Load unpacked</span> and select the extension folder.</p>
                </li>
              </ol>
            </div>

            {/* Test Scenarios */}
            <div className="p-8 bg-slate-900/50 border border-slate-800 rounded-3xl">
              <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-400" />
                Test Scenarios
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { 
                    level: 'Easy', 
                    goal: 'Search Wikipedia', 
                    prompt: 'Go to Wikipedia, search for "Larmor frequency", and click the first link.',
                    color: 'text-emerald-400'
                  },
                  { 
                    level: 'Medium', 
                    goal: 'Research arXiv', 
                    prompt: 'Navigate to arXiv.org, search for "Quantum Algorithms", and click the PDF link for the first result.',
                    color: 'text-amber-400'
                  },
                  { 
                    level: 'Hard', 
                    goal: 'GitHub Workflow', 
                    prompt: 'Go to GitHub, search for "FastAPI React", filter by stars, and click the top repo.',
                    color: 'text-rose-400'
                  }
                ].map((test, i) => (
                  <div key={i} className="p-5 bg-slate-950 rounded-2xl border border-slate-800 flex flex-col h-full">
                    <span className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${test.color}`}>{test.level}</span>
                    <h4 className="text-white font-semibold mb-2">{test.goal}</h4>
                    <p className="text-xs text-slate-500 leading-relaxed italic flex-grow">"{test.prompt}"</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-800 py-12 bg-slate-900/30">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-slate-500 text-sm">
            Built for 2nd-year CS students exploring AI & Browser Extensions.
          </p>
        </div>
      </footer>
    </div>
  );
}
