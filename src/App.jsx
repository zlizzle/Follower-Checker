import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { Shield, Upload, Users, UserCheck, UserX, Copy, Download, RefreshCw, ExternalLink, Heart, Github, Coffee, X, Search, Check, AlertCircle, Folder, Filter } from 'lucide-react'
import { FixedSizeList as List } from 'react-window'
import debounce from 'lodash/debounce'

const MAX_FILE_SIZE_MB = 5; // 5MB per file
const MAX_TOTAL_ENTRIES = 20000; // 10k per file, 20k total
const COOLDOWN_MS = 2000;
const ALLOWED_FILE_TYPES = ['.json'];
const BATCH_SIZE = 1000; // Process users in batches
const FOLLOWERS_PREFIX = 'followers_';
const FOLLOWING_FILE = 'following.json';
const EXPORT_FOLDER = 'followers_and_following';

// Browser support detection
const supportsFolderUpload = () => {
  const input = document.createElement('input');
  return 'webkitdirectory' in input;
};

// File filtering utilities
const isFollowingFile = (file) => file.name === FOLLOWING_FILE;
const isFollowersFile = (file) => file.name.startsWith(FOLLOWERS_PREFIX) && file.name.endsWith('.json');
const isValidFile = (file) => isFollowingFile(file) || isFollowersFile(file);

function App() {
  console.log('App component mounted');
  
  // Error handling states
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState(new Set());
  const [isProcessing, setIsProcessing] = useState(false);

  // State for folder upload
  const [supportsFolders, setSupportsFolders] = useState(true);
  const [uploadedFileCount, setUploadedFileCount] = useState(0);
  const [isFolderUpload, setIsFolderUpload] = useState(false);
  const [showFallback, setShowFallback] = useState(false);

  // Cleanup Tool states
  const [showCleanupTool, setShowCleanupTool] = useState(false);
  const [followingList, setFollowingList] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoadingFollowing, setIsLoadingFollowing] = useState(false);

  // File states
  const [followersFile, setFollowersFile] = useState(null);
  const [followingFile, setFollowingFile] = useState(null);
  const [results, setResults] = useState(null);
  const [checkedUsers, setCheckedUsers] = useState(new Set());
  const [showInstructions, setShowInstructions] = useState(false);
  const [activeTab, setActiveTab] = useState('desktop');
  const [toast, setToast] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const [cooldown, setCooldown] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [uploadGlow, setUploadGlow] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Animation state for results and mobile section
  const [showMobileSection, setShowMobileSection] = useState(false);
  const [mobileSectionRef, setMobileSectionRef] = useState(null);

  const [showTooltip, setShowTooltip] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Add fade-in state for instructions
  const [showInstructionsFade, setShowInstructionsFade] = useState(false);

  useEffect(() => {
    if (results) setShowResults(true);
    else setShowResults(false);
  }, [results]);

  // Animate mobile section on scroll into view
  useEffect(() => {
    const handleScroll = () => {
      if (!mobileSectionRef || !mobileSectionRef.current) return;
      const rect = mobileSectionRef.current.getBoundingClientRect();
      if (rect.top < window.innerHeight - 100) setShowMobileSection(true);
    };
    window.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Add glow effect on successful upload
  useEffect(() => {
    if (results) {
      setUploadGlow(true);
      const timeout = setTimeout(() => setUploadGlow(false), 1200);
      return () => clearTimeout(timeout);
    }
  }, [results]);

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    // Fade in on page load
    setTimeout(() => setShowInstructionsFade(true), 200);
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleFileUpload = useCallback(async (files) => {
    if (!files?.length) return;
    
    setIsProcessing(true);
    setError(null);
    setWarning(null);
    setIsLoadingFollowing(true);
    
    try {
      const newFiles = Array.from(files);
      
      // Check if this is a folder upload
      const isFolder = newFiles.some(file => file.webkitRelativePath?.includes('/'));
      setIsFolderUpload(isFolder);
      
      // Filter valid files
      const validFiles = newFiles.filter(file => {
        const path = file.webkitRelativePath || file.name;
        return path.includes(EXPORT_FOLDER) && isValidFile(file);
      });
      
      if (validFiles.length === 0) {
        throw new Error('No valid files found. Please make sure you\'re uploading the followers_and_following folder or the correct JSON files.');
      }
      
      // Separate following and followers files
      const followingFiles = validFiles.filter(isFollowingFile);
      const followersFiles = validFiles.filter(isFollowersFile);
      
      // Check for missing files
      if (!followingFiles.length) {
        throw new Error('We need your following.json file to compare.');
      }
      if (!followersFiles.length) {
        throw new Error('We need at least one followers_*.json file to compare.');
      }
      
      // Validate each file
      for (const file of validFiles) {
        validateFileType(file);
        const data = await validateFileContent(file);
        validateInstagramFormat(data);
      }
      
      // Update file count
      setUploadedFileCount(validFiles.length);
      
      // Process files
      let following = [];
      let followers = [];
      
      for (const file of validFiles) {
        const data = await validateFileContent(file);
        if (isFollowingFile(file)) {
          following = deduplicateUsernames(data.relationships_following.string_list_data.value);
          // Set following list for cleanup tool
          setFollowingList(following);
        } else if (isFollowersFile(file)) {
          followers = [...followers, ...data.relationships_followers.string_list_data.value];
        }
      }
      
      // Check for empty states
      if (!following.length) {
        setResults({ notFollowingBack: [], message: 'You aren\'t following anyone yet. Nothing to check here.' });
        return;
      }
      
      if (!followers.length) {
        setResults({ notFollowingBack: [], message: 'No one follows you yet. Clean slate, clean feed.' });
        return;
      }
      
      // Check for incomplete followers upload
      if (following.length > 1000 && followersFiles.length === 1) {
        setWarning('You may have multiple followers files. Try uploading followers_2.json, followers_3.json, etc. for full results.');
      }
      
      // Compare lists
      const notFollowingBack = following.filter(user => !followers.includes(user));
      
      if (notFollowingBack.length === 0) {
        setResults({ 
          notFollowingBack: [], 
          message: 'Everyone you follow follows you back. Your circle is complete.',
          subtext: 'Nice work. Looks like you\'ve curated your feed with intention.'
        });
      } else {
        setResults({ notFollowingBack });
      }
      
    } catch (err) {
      setError(err.message);
      setResults(null);
      setFollowingList([]);
      // Show fallback if folder upload fails
      if (isFolderUpload) {
        setShowFallback(true);
      }
    } finally {
      setIsProcessing(false);
      setIsLoadingFollowing(false);
    }
  }, [isFolderUpload]);

  // Check browser support on mount
  useEffect(() => {
    setSupportsFolders(supportsFolderUpload());
  }, []);

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    // Only allow .json files
    const files = Array.from(e.dataTransfer.files)
    if (files.some(f => !f.name.endsWith('.json'))) {
      showToast('Only .json files are allowed.', 'error')
      return
    }
    handleFileUpload(e.dataTransfer.files)
  }

  const toggleUserChecked = (username) => {
    const newChecked = new Set(checkedUsers)
    if (newChecked.has(username)) {
      newChecked.delete(username)
    } else {
      newChecked.add(username)
    }
    setCheckedUsers(newChecked)
  }

  // Debounced handlers
  const debouncedCopyUsernames = useMemo(
    () => debounce((usernames) => {
      navigator.clipboard.writeText(usernames.join('\n'))
      showToast('Usernames copied to clipboard!')
    }, 300),
    []
  );

  const debouncedDownloadCSV = useMemo(
    () => debounce((data, filename) => {
      const csv = ['Username,Instagram URL\n']
      data.forEach(username => {
        csv.push(`${username},https://instagram.com/${username}\n`)
      })
      
      const blob = new Blob([csv.join('')], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      showToast('CSV downloaded!')
    }, 300),
    []
  );

  // Memoized list data
  const notFollowingBackList = useMemo(() => {
    if (!results?.notFollowingBack) return [];
    return results.notFollowingBack;
  }, [results?.notFollowingBack]);

  const youDontFollowBackList = useMemo(() => {
    if (!results?.youDontFollowBack) return [];
    return results.youDontFollowBack;
  }, [results?.youDontFollowBack]);

  // Optimized row renderer
  const VirtualizedRow = useCallback(({ data, index, style, type, checkedUsers, toggleUserChecked }) => {
    const username = data[index];
    return (
      <div style={style} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center min-w-0 flex-1">
          <input
            type="checkbox"
            checked={checkedUsers.has(username)}
            onChange={() => toggleUserChecked(username)}
            className="mr-3 rounded border-gray-300 text-purple-600 focus:ring-purple-500 flex-shrink-0"
          />
          <a
            href={`https://instagram.com/${username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-600 hover:text-purple-700 font-medium flex items-center min-w-0"
          >
            <span className="truncate">@{username}</span>
          </a>
        </div>
      </div>
    );
  }, []);

  const openNextProfile = (usernames, startIndex = 0) => {
    const uncheckedUsers = usernames.filter(username => !checkedUsers.has(username))
    if (uncheckedUsers.length > 0) {
      window.open(`https://instagram.com/${uncheckedUsers[0]}`, '_blank')
    }
  }

  const resetApp = () => {
    setFollowersFile(null)
    setFollowingFile(null)
    setResults(null)
    setCheckedUsers(new Set())
    setShowInstructions(false)
    setIsProcessing(false)
  }

  const getProgressText = () => {
    if (!results) return ''
    const total = results.notFollowingBack.length + results.youDontFollowBack.length
    const checked = checkedUsers.size
    return `You've cleaned up ${checked} of ${total} connections`
  }

  // Copy steps text
  const stepsText = `How to Download Your Instagram Data\n\n1. Go to your Instagram settings: Settings and activity → Accounts Center\n2. Tap or click: Your information and permissions → Download your information\n3. Select: Download or transfer information → Some of your information\n4. Scroll down and check only: Connections → Followers and Following\n5. Tap Next, then set:\n   - Format: JSON\n   - Destination: Download to device\n6. Tap Create files (Instagram will prepare the download)\n\nFinal Step – Upload Your Files:\n- Unzip the file\n- Open the folder: followers_and_following/\n- Upload these files here:\n  - following.json\n  - followers_1.json\n  - (optional) followers_2.json, followers_3.json, etc.\n\nThis is 100% private. Everything stays on your device.`;

  const handleCopySteps = async () => {
    try {
      await navigator.clipboard.writeText(stepsText);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      setCopySuccess(false);
    }
  };

  // Utility functions for file validation
  const validateFileType = (file) => {
    if (!file.name.endsWith('.json')) {
      throw new Error('It looks like this isn\'t a JSON file. Make sure to select JSON format when downloading your data from Instagram.');
    }
    return true;
  };

  const validateFileContent = async (file) => {
    try {
      const text = await file.text();
      if (!text || text.trim() === '') {
        throw new Error('Something went wrong. One or more files appear empty or unreadable. Make sure you chose the JSON format from Instagram when exporting.');
      }
      const data = JSON.parse(text);
      return data;
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error('Something went wrong. One or more files appear empty or unreadable. Make sure you chose the JSON format from Instagram when exporting.');
      }
      throw e;
    }
  };

  const validateInstagramFormat = (data) => {
    const hasFollowing = data.relationships_following?.string_list_data?.value;
    const hasFollowers = data.relationships_followers?.string_list_data?.value;
    
    if (!hasFollowing && !hasFollowers) {
      throw new Error('These files do not look like real Instagram exports. Please upload files directly from Instagram\'s download tool.');
    }
    return true;
  };

  const deduplicateUsernames = (usernames) => {
    const unique = [...new Set(usernames)];
    if (unique.length !== usernames.length) {
      setWarning('We cleaned up a few duplicates before comparing.');
    }
    return unique;
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navigation Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-gray-900/80 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <span className="text-xl font-bold text-teal-400">FollowCheck</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-16">
        <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black transition-all duration-300">
          <div className="max-w-3xl mx-auto py-20 px-6 space-y-10">
            {/* Header */}
            <header className="text-center space-y-6">
              <div className="text-3xl font-bold text-teal-400 tracking-tight mb-2 select-none" style={{fontFamily: 'Inter, sans-serif', letterSpacing: '-0.02em'}}>FollowCheck</div>
              <h1 className="text-4xl font-bold text-white tracking-tight max-w-2xl mx-auto">Instagram Follower Checker</h1>
              <p className="text-base text-gray-500 italic text-center max-w-xl mx-auto mt-2 mb-2 truncate" style={{fontWeight: 400, fontSize: '1rem', opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>We built this because your feed should feel like your life, not a list.</p>
              <p className="text-base text-gray-300 max-w-xl mx-auto mt-2 mb-4">See who you follow that isn't following you back. No sign-in needed, and your info stays private on your device.</p>
            </header>

            {/* Visual cue divider */}
            <hr className="my-10 border-t border-white/10 opacity-40" />

            {/* Transition heading and explanation */}
            <div className="text-center mb-8">
              <h2 className="text-xl font-semibold text-white mb-2">Ready to check your followers? Start here:</h2>
              <p className="text-base text-gray-400">Upload your Instagram data export below. It stays private and only takes a moment.</p>
            </div>

            {/* Instructional Section: How to Download Your Instagram Data */}
            <section className={`bg-gray-900 rounded-2xl shadow-lg shadow-white/5 ring-1 ring-white/10 p-8 max-w-2xl mx-auto mb-16 mt-12 transition-opacity duration-1000 ${showInstructionsFade ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}> 
              <h2 className="text-2xl font-bold text-white mb-2">How to Download Your Instagram Data</h2>
              <p className="text-base text-gray-400 mb-6">These steps work the same on your phone or desktop. You don't need to log in here. Just upload your own data.</p>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
                <button
                  onClick={handleCopySteps}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 text-sm text-teal-300 hover:bg-gray-700 transition-all duration-200"
                  aria-label="Copy these steps"
                >
                  <span>Copy these steps</span>
                  {copySuccess && <span className="text-teal-400">Copied!</span>}
                </button>
              </div>
              <ol className="space-y-4 text-base text-white">
                <li className="flex items-center gap-2"><span className={`w-6 h-6 flex items-center justify-center rounded-full font-bold ${results ? 'bg-teal-400 text-white' : 'bg-gray-700 text-white'}`}>1</span> <span>Go to your Instagram settings:<br /><span className="text-gray-300">Settings and activity → Accounts Center</span></span></li>
                <li className="flex items-center gap-2"><span className={`w-6 h-6 flex items-center justify-center rounded-full font-bold ${results ? 'bg-teal-400 text-white' : 'bg-gray-700 text-white'}`}>2</span> <span>Tap or click:<br /><span className="text-gray-300">Your information and permissions → Download your information</span></span></li>
                <li className="flex items-center gap-2"><span className={`w-6 h-6 flex items-center justify-center rounded-full font-bold ${results ? 'bg-teal-400 text-white' : 'bg-gray-700 text-white'}`}>3</span> <span>Select:<br /><span className="text-gray-300">Download or transfer information → Some of your information</span></span></li>
                <li className="flex items-center gap-2"><span className={`w-6 h-6 flex items-center justify-center rounded-full font-bold ${results ? 'bg-teal-400 text-white' : 'bg-gray-700 text-white'}`}>4</span> <span>Scroll down and check only:<br /><span className="inline-block mt-1 px-2 py-1 bg-gray-800 rounded text-teal-400 font-semibold">Connections → Followers and Following</span></span></li>
                <li className="flex items-center gap-2"><span className={`w-6 h-6 flex items-center justify-center rounded-full font-bold ${results ? 'bg-teal-400 text-white' : 'bg-gray-700 text-white'}`}>5</span> <span>Tap <span className="font-bold">Next</span>, then set:<br />
                  <span className="ml-4">Format: JSON</span><br />
                  <span className="ml-4">Destination: Download to device</span></span></li>
                <li className="flex items-center gap-2"><span className={`w-6 h-6 flex items-center justify-center rounded-full font-bold ${results ? 'bg-teal-400 text-white' : 'bg-gray-700 text-white'}`}>6</span> <span>Tap <span className="font-bold">Create files</span><br /><span className="text-gray-300">Instagram will prepare the download. It might take a few minutes.</span></span></li>
              </ol>
            </section>

            {/* Upload Section */}
            <section className={`bg-gray-900 rounded-2xl shadow-lg shadow-white/5 ring-1 ring-white/10 p-8 max-w-2xl mx-auto transition-all duration-200 ${uploadGlow ? 'ring-2 ring-teal-400/60 shadow-teal-400/10' : ''}`}> 
              <div className="text-center mb-10 flex flex-col items-center gap-2">
                <h2 className="text-4xl font-bold text-white tracking-tight mb-2">Upload Your Data</h2>
                <p className="text-lg text-gray-400">Just follow the steps above. No login needed.</p>
                
                {/* Error Display */}
                {error && (
                  <div className="w-full mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                      <AlertCircle className="w-5 h-5" />
                      <span className="font-medium">{error}</span>
                    </div>
                  </div>
                )}
                
                {/* Warning Display */}
                {warning && (
                  <div className="w-full mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                    <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                      <AlertCircle className="w-5 h-5" />
                      <span className="font-medium">{warning}</span>
                    </div>
                  </div>
                )}
                
                {/* Mobile Upload Help */}
                {isMobile && (
                  <div className="w-full mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                      <span className="font-medium">Having trouble uploading on your phone? Tap 'Browse files' instead of dragging.</span>
                    </div>
                  </div>
                )}
                
                {/* Folder Upload Support Notice */}
                {!supportsFolders && !showFallback && (
                  <div className="w-full mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                      <span className="font-medium">If your device does not support folder uploads, you can manually select the files instead.</span>
                    </div>
                  </div>
                )}
              </div>

              <div
                className={`upload-zone ${isDragOver ? 'dragover' : ''} transition-all duration-200 ease-in-out ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                tabIndex={0}
                style={{ fontSize: '1.1rem' }}
              >
                {isFolderUpload ? (
                  <Folder className={`w-14 h-14 text-teal-400 mx-auto mb-4 transition-all duration-200 ease-in-out hover:scale-105 ${results ? 'animate-bounce' : ''}`} />
                ) : (
                  <Upload className={`w-14 h-14 text-teal-400 mx-auto mb-4 transition-all duration-200 ease-in-out hover:scale-105 ${results ? 'animate-bounce' : ''}`} />
                )}
                <p className="text-xl font-bold text-white mb-2">
                  {isFolderUpload ? '📁 Drop your followers_and_following folder here' : '📁 Drop your files here'}
                </p>
                <p className="text-base text-white mb-4">
                  or <button className="text-teal-400 hover:underline font-medium transition-all duration-200 ease-in-out" onClick={() => fileInputRef.current && fileInputRef.current.click()}>browse files</button>
                </p>
                <p className="text-base text-teal-400 text-center mt-2">
                  {isFolderUpload ? (
                    'Upload the entire followers_and_following folder. We\'ll find the right files.'
                  ) : (
                    'Upload following.json and all followers_*.json files. Don\'t worry, we\'ll handle the rest.'
                  )}
                </p>
                
                {/* File Count Display */}
                {uploadedFileCount > 0 && (
                  <div className="mt-4 text-sm text-teal-400">
                    Found {uploadedFileCount} valid file{uploadedFileCount !== 1 ? 's' : ''}
                  </div>
                )}
                
                {/* Hidden File Input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  webkitdirectory={supportsFolders && !showFallback}
                  accept=".json"
                  onChange={(e) => handleFileUpload(e.target.files)}
                  className="hidden"
                />
                
                {results && (
                  <div className="mt-4 text-green-400 text-sm font-semibold">Files uploaded successfully! You can now review your results below.</div>
                )}
              </div>
            </section>

            {/* Mobile Screenshot Section */}
            <section className="py-16">
              <div className="max-w-2xl mx-auto">
                <h2 className="text-3xl font-semibold text-white text-center">Built for your phone, too</h2>
                <p className="text-lg text-gray-400 text-center mt-2 mb-10">Everything works in your browser. No logins, no downloads.</p>
                <div className="flex flex-col md:flex-row gap-6 justify-center items-start mt-6">
                  {/* Step 1 */}
                  <div className="w-full md:w-1/3 p-4 bg-zinc-800 rounded-xl shadow-md text-center flex flex-col items-center">
                    <img src="/mobile1.png" alt="Step 1 – Upload your files" className="rounded-lg w-full object-cover" style={{ fontSize: '1.1rem' }} />
                    <p className="mt-2 text-sm text-gray-400">Step 1 – Upload your files</p>
                  </div>
                  {/* Step 2 */}
                  <div className="w-full md:w-1/3 p-4 bg-zinc-800 rounded-xl shadow-md text-center flex flex-col items-center">
                    <img src="/mobile2.png" alt="Step 2 – Confirm your data" className="rounded-lg w-full object-cover" style={{ fontSize: '1.1rem' }} />
                    <p className="mt-2 text-sm text-gray-400">Step 2 – Confirm your data</p>
                  </div>
                  {/* Step 3 */}
                  <div className="w-full md:w-1/3 p-4 bg-zinc-800 rounded-xl shadow-md text-center flex flex-col items-center">
                    <img src="/mobile3.png" alt="Step 3 – See your results" className="rounded-lg w-full object-cover" style={{ fontSize: '1.1rem' }} />
                    <p className="mt-2 text-sm text-gray-400">Step 3 – See your results</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Results Section */}
            {results && (
              <div className={`transition-all duration-700 ease-in-out ${showResults ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'} py-20`}>
                {results.message ? (
                  <div className="text-center max-w-2xl mx-auto">
                    <div className="text-2xl font-bold text-white mb-4">{results.message}</div>
                    {results.subtext && (
                      <div className="text-lg text-gray-400">{results.subtext}</div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="mb-8 text-center text-green-400 text-lg font-semibold">You're all set! Review your results below.</div>
                    {/* Progress Tracker */}
                    <div className="card">
                      <h3 className="heading-3 mb-2">Progress</h3>
                      <p className="text-body">{getProgressText()}</p>
                      <div className="mt-3 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div 
                          className="bg-teal-500 h-2 rounded-full transition-all duration-300"
                          style={{ 
                            width: `${results.notFollowingBack.length + results.youDontFollowBack.length > 0 
                              ? (checkedUsers.size / (results.notFollowingBack.length + results.youDontFollowBack.length)) * 100 
                              : 0}%` 
                          }}
                        ></div>
                      </div>
                    </div>

                    {/* Not Following Back */}
                    <div className="card">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 space-y-2 md:space-y-0">
                        <div className="flex items-center">
                          <UserX className="w-6 h-6 text-red-500 mr-2" />
                          <h3 className="heading-3">
                            Users you follow who don't follow you back ({notFollowingBackList.length})
                          </h3>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => debouncedCopyUsernames(notFollowingBackList)}
                            className="btn-secondary flex items-center text-sm"
                          >
                            <Copy className="w-4 h-4 mr-1" />
                            Copy All
                          </button>
                          <button
                            onClick={() => debouncedDownloadCSV(notFollowingBackList, 'not-following-back.csv')}
                            className="btn-secondary flex items-center text-sm"
                          >
                            <Download className="w-4 h-4 mr-1" />
                            CSV
                          </button>
                          <button
                            onClick={() => openNextProfile(notFollowingBackList)}
                            className="btn-primary flex items-center text-sm"
                          >
                            <ExternalLink className="w-4 h-4 mr-1" />
                            Open Next Profile
                          </button>
                        </div>
                      </div>
                      
                      {notFollowingBackList.length > 100 ? (
                        <List
                          height={400}
                          itemCount={notFollowingBackList.length}
                          itemSize={56}
                          width="100%"
                          itemData={notFollowingBackList}
                        >
                          {props => (
                            <VirtualizedRow
                              {...props}
                              type="notFollowingBack"
                              checkedUsers={checkedUsers}
                              toggleUserChecked={toggleUserChecked}
                            />
                          )}
                        </List>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {notFollowingBackList.map((username) => (
                            <div key={username} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                              <div className="flex items-center min-w-0 flex-1">
                                <input
                                  type="checkbox"
                                  checked={checkedUsers.has(username)}
                                  onChange={() => toggleUserChecked(username)}
                                  className="mr-3 rounded border-gray-300 dark:border-gray-600 text-teal-500 focus:ring-teal-500 flex-shrink-0"
                                />
                                <a
                                  href={`https://instagram.com/${username}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 font-medium flex items-center min-w-0"
                                >
                                  <span className="truncate">@{username}</span>
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* You Don't Follow Back */}
                    <div className="card">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 space-y-2 md:space-y-0">
                        <div className="flex items-center">
                          <UserCheck className="w-6 h-6 text-green-500 mr-2" />
                          <h3 className="heading-3">
                            Users who follow you that you don't follow back ({youDontFollowBackList.length})
                          </h3>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => debouncedCopyUsernames(youDontFollowBackList)}
                            className="btn-secondary flex items-center text-sm"
                          >
                            <Copy className="w-4 h-4 mr-1" />
                            Copy All
                          </button>
                          <button
                            onClick={() => debouncedDownloadCSV(youDontFollowBackList, 'you-dont-follow-back.csv')}
                            className="btn-secondary flex items-center text-sm"
                          >
                            <Download className="w-4 h-4 mr-1" />
                            CSV
                          </button>
                        </div>
                      </div>
                      
                      {youDontFollowBackList.length > 100 ? (
                        <List
                          height={400}
                          itemCount={youDontFollowBackList.length}
                          itemSize={56}
                          width="100%"
                          itemData={youDontFollowBackList}
                        >
                          {props => (
                            <VirtualizedRow
                              {...props}
                              type="youDontFollowBack"
                              checkedUsers={checkedUsers}
                              toggleUserChecked={toggleUserChecked}
                            />
                          )}
                        </List>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {youDontFollowBackList.map((username) => (
                            <div key={username} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                              <div className="flex items-center min-w-0 flex-1">
                                <input
                                  type="checkbox"
                                  checked={checkedUsers.has(username)}
                                  onChange={() => toggleUserChecked(username)}
                                  className="mr-3 rounded border-gray-300 dark:border-gray-600 text-teal-500 focus:ring-teal-500 flex-shrink-0"
                                />
                                <a
                                  href={`https://instagram.com/${username}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 font-medium flex items-center min-w-0"
                                >
                                  <span className="truncate">@{username}</span>
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Toast */}
            {toast && (
              <div className={`toast ${toast.type === 'error' ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' : 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400'} transition-all duration-200`}> 
                {toast.message}
              </div>
            )}

            {/* Supportive Ethos Statement */}
            <div className="text-sm text-gray-500 text-center max-w-md mx-auto mt-12">
              "Clear your digital space. Your energy belongs to you. We're just here to help you focus it."
            </div>

            {/* Legal Disclaimer */}
            <div className="text-xs text-gray-500 text-center max-w-xl mx-auto mt-8 mb-4 px-2">
              This tool is not affiliated with, endorsed by, or connected to Instagram or Meta. It only uses data that you download yourself using Instagram's official export feature.
            </div>

            {/* Footer */}
            <footer className="flex flex-col items-center justify-center gap-2 text-sm text-gray-500 mt-12 pt-6 border-t border-white/10">
              <div className="flex justify-center gap-6 mb-2">
                <a href="https://github.com/zlizzle/Follower-Checker" target="_blank" rel="noopener noreferrer" className="hover:text-teal-400 transition-all duration-200 ease-in-out flex items-center gap-1">
                  <span>⭐</span> Star on GitHub
                </a>
                <a href="https://buymeacoffee.com/slizzle" target="_blank" rel="noopener noreferrer" className="hover:text-teal-400 transition-all duration-200 ease-in-out flex items-center gap-1">
                  <span>☕</span> Buy me a coffee
                </a>
              </div>
              <div className="text-xs text-gray-400 text-center">
                Made with privacy in mind. No data leaves your browser.<br />
              </div>
            </footer>

            {/* Cleanup Tool Section */}
            {results && (
              <div className="mt-12 max-w-2xl mx-auto">
                <button
                  onClick={() => setShowCleanupTool(!showCleanupTool)}
                  className="w-full p-4 bg-gray-800 hover:bg-gray-700 rounded-xl transition-all duration-200 flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <Filter className="w-5 h-5 text-teal-400" />
                    <div className="text-left">
                      <div className="text-lg font-semibold text-white">Review Your Following List</div>
                      <div className="text-sm text-gray-400">Take a moment to reflect on who you follow</div>
                    </div>
                  </div>
                  <div className="text-gray-400 group-hover:text-white transition-colors">
                    {showCleanupTool ? 'Hide' : 'Show'}
                  </div>
                </button>

                {showCleanupTool && (
                  <div className="mt-6 bg-gray-900 rounded-xl p-6">
                    <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg">
                      <p className="text-blue-600 dark:text-blue-400 text-sm">
                        We'll never judge. This is your space to reflect and keep your feed meaningful.
                      </p>
                    </div>

                    {/* Search Bar */}
                    <div className="relative mb-6">
                      <input
                        type="text"
                        placeholder="Search usernames..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                      />
                      <Search className="absolute right-3 top-2.5 w-5 h-5 text-gray-400" />
                    </div>

                    {/* Following List */}
                    <div className="space-y-2">
                      {isLoadingFollowing ? (
                        <div className="text-center py-8">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-400 mx-auto"></div>
                          <p className="mt-2 text-gray-400">Loading your following list...</p>
                        </div>
                      ) : followingList.length === 0 ? (
                        <div className="text-center py-8">
                          <p className="text-gray-400">We couldn't detect any accounts you follow. Try re-uploading your export file.</p>
                        </div>
                      ) : (
                        <div className="max-h-[60vh] overflow-y-auto pr-2">
                          {followingList
                            .filter(user => user.toLowerCase().includes(searchTerm.toLowerCase()))
                            .map((username, index) => (
                              <a
                                key={index}
                                href={`https://instagram.com/${username}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block p-3 hover:bg-gray-800 rounded-lg transition-colors group"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-white group-hover:text-teal-400 transition-colors">@{username}</span>
                                  <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-teal-400 transition-colors" />
                                </div>
                              </a>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App
